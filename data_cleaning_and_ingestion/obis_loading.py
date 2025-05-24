import pandas as pd
import os
from pathlib import Path
from sqlalchemy import create_engine
import urllib.parse
import time  # Added for time tracking

def load_to_rds_in_batches(parquet_files, engine, table_name, batch_size=100):
    start_time = time.time()
    print(f"Starting to process {len(parquet_files)} files in batches of {batch_size}")
    
    # Process first batch with replace to create table
    current_batch = parquet_files[:batch_size]
    process_batch(current_batch, engine, table_name, 'replace', 1)
    
    # Process remaining batches with append
    for i in range(batch_size, len(parquet_files), batch_size):
        batch_number = (i // batch_size) + 1
        current_batch = parquet_files[i:i + batch_size]
        process_batch(current_batch, engine, table_name, 'append', batch_number)
        
        # Show elapsed time and estimate
        elapsed_time = time.time() - start_time
        progress = i / len(parquet_files)
        estimated_total = elapsed_time / progress if progress > 0 else 0
        print(f"Progress: {progress:.1%}")
        print(f"Time elapsed: {elapsed_time/60:.1f} minutes")
        print(f"Estimated total time: {estimated_total/60:.1f} minutes")

def process_batch(batch_files, engine, table_name, if_exists, batch_number):
    print(f"\nProcessing batch {batch_number}...")
    print(f"Reading {len(batch_files)} files...")
    
    dfs = []
    for i, file in enumerate(batch_files, 1):
        df = pd.read_parquet(file)
        # Filter for 2015 data
        if 'year' in df.columns:
            df = df[df['year'] == 2015]
            if not df.empty:  # Only append if we have 2015 data
                dfs.append(df)
        if i % 10 == 0:  # Progress update every 10 files
            print(f"Read {i} files in current batch")
    
    if not dfs:  # Skip if no 2015 data in this batch
        print(f"No 2015 data found in batch {batch_number}, skipping...")
        return
    
    batch_df = pd.concat(dfs, ignore_index=True)
    print(f"Rows in this batch (2015 only): {len(batch_df)}")
    
    print(f"Uploading batch {batch_number} to RDS...")
    try:
        batch_df.to_sql(
            name=table_name,
            con=engine,
            if_exists=if_exists,
            index=False,
            chunksize=1000
        )
        print(f"✓ Batch {batch_number} upload successful!")
    except Exception as e:
        print(f"❌ Error during batch {batch_number} upload: {str(e)}")
        raise e

# RDS connection settings - PLACEHOLDERS ONLY - DATABASE DELETED
USERNAME = "placeholder_username"
PASSWORD = "placeholder_password"
HOST = "placeholder_host"
PORT = "5432"
DATABASE = "placeholder_database"
TABLE_NAME = "OBIS_2015"

# Create the SQLAlchemy engine
encoded_password = urllib.parse.quote_plus(PASSWORD)
engine = create_engine(f'postgresql://{USERNAME}:{encoded_password}@{HOST}:{PORT}/{DATABASE}')

# Your path and get all parquet files
root_folder = r"C:\Users\user\Downloads\final_ocean_data\final_ocean_data.parquet"
parquet_files = [f.path for f in os.scandir(root_folder) if f.is_dir()]
all_files = []
for subdir in parquet_files:
    for root, dirs, files in os.walk(subdir):
        for file in files:
            if file.endswith('.parquet'):
                all_files.append(os.path.join(root, file))

print(f"Found {len(all_files)} parquet files")

# Process files in batches
load_to_rds_in_batches(all_files, engine, TABLE_NAME, batch_size=50)