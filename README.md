# Ocean Biodiversity & Climate Change Explorer 🌊

## Overview
This project combines data from the World Ocean Database (WOD) and the Ocean Biodiversity Information System (OBIS) to create an interactive platform for exploring marine biodiversity and ocean conditions. The application integrates ocean temperature, salinity, and species occurrence data to provide researchers and interested users with tools to explore marine life and ocean characteristics across different locations.

## Note
This project was done in a group of 4, utilizing a postgreSQL database hosted on AWS. Due to costs the database has been deleted, but there is a demo video below as well as detailed documentation on the whole project.

## Reponsibilities
- Lowkey carried this project
Key things I did
1. Completely Preprocessed OBIS data in google colab and loaded it into AWS, this had many problems to solve mostly involving size of datasets, but more details in documentation
2. After OBIS and WOD loaded into AWS, normalized the database and did most of the optimizations, details in docs
3. Though it was not my role, wrote 2 advanced queries/routes for the species page. One on the advnaced species search involving multiple filters and one invloving species cards when you click on a species name
4. For those advanced queries, also handled frontend, inclduing a paginated table for search results and a modal for the species card. Also made the navbar but that was simple. Note this was all the frontend aI did, the rest of spcies page was not me and thus looks much worse.
5. Wriote most of the documentation, including data preprocessing and loading section, ER diagram, table deatils etc.
   (Could also mention some group memebers literally did not do anything but that seems a bit bad so will just list what I did)

Demo Video Link: https://www.youtube.com/watch?v=fFq6oStJ7bc

Documentation link: 
