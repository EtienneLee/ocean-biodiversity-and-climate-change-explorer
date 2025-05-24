import pandas as pd
import os
from pathlib import Path
from sqlalchemy import create_engine
import urllib.parse
import time

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
        try:
            df = pd.read_parquet(file)
            dfs.append(df)
            if i % 10 == 0:  # Progress update every 10 files
                print(f"Read {i} files in current batch")
        except Exception as e:
            print(f"Error reading file {file}: {str(e)}")
            continue
   
    if not dfs:  # Skip if no data in this batch
        print(f"No data found in batch {batch_number}, skipping...")
        return
   
    batch_df = pd.concat(dfs, ignore_index=True)
    print(f"Rows in this batch: {len(batch_df)}")
   
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
        
        # Cleanup
        del dfs, batch_df
        import gc
        gc.collect()
        
    except Exception as e:
        print(f"❌ Error during batch {batch_number} upload: {str(e)}")
        raise e

# RDS connection settings - PLACEHOLDERS ONLY - DATABASE DELETED
USERNAME = "placeholder_username"
PASSWORD = "placeholder_password"
HOST = "placeholder_host"
PORT = "5432"
DATABASE = "placeholder_database"
TABLE_NAME = "DEPTH_2015"

# Create the SQLAlchemy engine
encoded_password = urllib.parse.quote_plus(PASSWORD)
engine = create_engine(f'postgresql://{USERNAME}:{encoded_password}@{HOST}:{PORT}/{DATABASE}')

# Your path and get all parquet files - SIMPLIFIED VERSION
root_folder = r"C:\Users\user\Downloads\final_depth_data"  # Remove the file name from the path
all_files = [os.path.join(root_folder, f) for f in os.listdir(root_folder) if f.endswith('.parquet')]

print(f"Found {len(all_files)} parquet files")

# Process files in batches
load_to_rds_in_batches(all_files, engine, TABLE_NAME, batch_size=50)