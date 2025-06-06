// server/routes/routes.js
const express = require('express');
const router = express.Router();
const { Pool, types } = require('pg');
const config = require('./config.json');
const { from } = require('form-data');

const connection = new Pool({
  host: config.rds_host,
  user: config.rds_user,
  password: config.rds_password,
  port: config.rds_port,
  database: config.rds_db,
  ssl: {
    rejectUnauthorized: false,
  },
});
connection.connect((err) => err && console.log(err));

// Define a simple route
router.get('/', (req, res) => {
  res.send('Hello from the API!');
});

// Route handlers
// TEST ROUTE
const test = async (req, res) => {
  try {
    const result = await connection.query(`
      SELECT obis.id AS occurrenceid, obis."eventDate" AS eventdate
      FROM obis
      LIMIT 10;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};



// SPECIES PAGE ROUTES

const getMarineBrackishCounts = async (req, res) => {
  try {
    const result = await connection.query(`
      SELECT
        CASE 
          WHEN marine = true AND brackish = true THEN 'Both Marine and Brackish'
          WHEN marine = true THEN 'Marine Only'
          WHEN brackish = true THEN 'Brackish Only'
          ELSE 'Neither'
        END AS habitat_type,
        COUNT(DISTINCT aphiaid) AS species_count
      FROM obis
      WHERE marine IS NOT NULL OR brackish IS NOT NULL
      GROUP BY habitat_type
      ORDER BY species_count DESC;
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching marine/brackish counts:', err);
    res.status(500).json([]);
  }
};

const searchSpecies = (req, res) => {
  console.log('Received request at /search_species');
  console.log('Query params:', req.query);

  // Add pagination parameters
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  // Required
  const scientificName = req.query.scientificName ?? '';
  if (!scientificName) {
      return res.status(400).json({ error: 'Scientific name is required' });
  }

  // Always included with defaults
  const depthMin = req.query.depth_min ?? 0;
  const depthMax = req.query.depth_max ?? 11000;
  const sightingsMin = req.query.sightings_min ?? 1;
  const sightingsMax = req.query.sightings_max ?? 200000;

  // Checkboxes (true/false)
  const marine = req.query.marine === 'true';
  const brackish = req.query.brackish === 'true';

  // Temperature - only optional filter
  const tempMin = req.query.temp_min;
  const tempMax = req.query.temp_max;

  // Base query
  let query = `
  SELECT sn."scientificName", COUNT(*) as num_sightings
  FROM scientific_names sn
  JOIN obis o ON sn.aphiaid = o.aphiaid
  `;

  // Add WHERE clause after JOIN
  const whereClauses = [`sn."scientificName" ILIKE '${scientificName}%'`, `o.depth BETWEEN ${depthMin} AND ${depthMax}`];

  // Habitat conditions
  if (marine || brackish) {
  const habitats = [];
  if (marine) habitats.push('o.marine = true'); 
  if (brackish) habitats.push('o.brackish = true'); 
  whereClauses.push(`(${habitats.join(' OR ')})`);
  }

  // Add temperature conditions only if needed
  if (tempMin !== undefined && tempMax !== undefined) {
  query += `
      LEFT JOIN wod_2015 w ON o.grid_id = w.grid_id
                        AND o.depth_id = w.depth_id
                        AND o."dayOfYear" = w."dayOfYear"
  `;
  whereClauses.push(`(CASE WHEN w.temperature IS NOT NULL THEN w.temperature WHEN o.depth_id = 1 THEN o.sst END) BETWEEN ${tempMin} AND ${tempMax}`);
  }

  if (whereClauses.length > 0) {
  query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  query += ` GROUP BY sn."scientificName" HAVING COUNT(*) BETWEEN ${sightingsMin} AND ${sightingsMax}
             ORDER BY num_sightings DESC
             LIMIT ${pageSize} OFFSET ${offset}`;

  connection.query(query, (err, data) => {
      if (err) {
          console.error('Error executing query:', err);
          res.status(500).json({ error: 'Database error' });
      } else {
          console.log('Successfully returned data:', data.rows);
          res.json(data.rows);
      }
  });
};

const detailedSpeciesInfo = async (req, res) => {

  console.log('Route hit with params:', req.params);
  console.log('Scientific name:', req.params.scientificName);

  const { scientificName } = req.params;
  
  connection.query(`
  WITH species_data AS (
      SELECT o.marine, o.brackish, o.depth,
              w.temperature, w.salinity, w.phosphate, w.nitrate,
              w.chlorophyll, w.ph, sn."scientificName", f.family
      FROM obis o
      LEFT JOIN wod_2015 w
          ON o.grid_id = w.grid_id
          AND o.depth_id = w.depth_id
          AND o."dayOfYear" = w."dayOfYear"
      JOIN scientific_names sn ON o.aphiaid = sn.aphiaid
      JOIN families f ON sn."scientificName" = f."scientificName"
      WHERE sn."scientificName" ILIKE '${scientificName}%'
  )
  SELECT
      CASE
          WHEN bool_or(marine) = true THEN true
          WHEN bool_and(marine IS false) THEN false
          ELSE null
      END as marine,
      CASE
          WHEN bool_or(brackish) = true THEN true
          WHEN bool_and(brackish IS false) THEN false
          ELSE null
      END as brackish,
      CASE WHEN COUNT(depth) = 0 THEN null ELSE AVG(depth) END as averageDepth,
      CASE WHEN COUNT(temperature) = 0 THEN null ELSE AVG(temperature) END as averageTemperature,
      CASE WHEN COUNT(salinity) = 0 THEN null ELSE AVG(salinity) END as averageSalinity,
      CASE WHEN COUNT(phosphate) = 0 THEN null ELSE AVG(phosphate) END as averagePhosphate,
      CASE WHEN COUNT(nitrate) = 0 THEN null ELSE AVG(nitrate) END as averageNitrate,
      CASE WHEN COUNT(chlorophyll) = 0 THEN null ELSE AVG(chlorophyll) END as averageChlorophyll,
      CASE WHEN COUNT(ph) = 0 THEN null ELSE AVG(ph) END as averagePh,
      "scientificName",
      "family"
  FROM species_data
  GROUP BY "scientificName", family;`, (err, data)=> {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Server error" });
    } else if (data.rows.length === 0) {
      return res.status(404).json({ message: "Species not found" });
    } else {
      res.json(data.rows[0]);
      console.log('Successfully returned data:', data.rows);
    }
  })
}

const getRandomSpecies = async (req, res) => {
  try {
    // Get the total number of observations
    const totalResult = await connection.query(`
      SELECT COUNT(*) AS total_count
      FROM obis
    `);
    
    const totalCount = parseInt(totalResult.rows[0].total_count);
    
    // Get random species with observation counts and rarity (without total_observations column)
    const result = await connection.query(`
      SELECT 
        sn.aphiaid AS id,
        sn."scientificName",
        COUNT(o.id) AS observation_count,
        ROUND(((COUNT(o.id)::float / $1::float) * 100)::numeric, 6) AS percentage_of_total,
        (1 - (COUNT(o.id)::float / $1::float)) AS rarity_score
      FROM scientific_names sn
      JOIN obis o ON sn.aphiaid = o.aphiaid
      GROUP BY sn.aphiaid, sn."scientificName"
      ORDER BY RANDOM()
      LIMIT 10;
    `, [totalCount]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching random species with rarity:', err);
    res.status(500).json([]);
  }
};


const getMostObservedSpecies = async (req, res) => {
  try {
    const result = await connection.query(`
      SELECT sn."scientificName",
             COUNT(*) AS obs_count
      FROM obis o
      JOIN scientific_names sn
        ON o.aphiaid = sn.aphiaid
      GROUP BY sn."scientificName"
      ORDER BY obs_count DESC
      LIMIT 10;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};

const getSpeciesCooccurrence = async (req, res) => {
  try {
    const result = await connection.query(`
      WITH species_locations AS (
        SELECT 
          o.aphiaid,
          sn."scientificName",
          ROUND(o."decimalLatitude"::numeric, 1) AS lat_grid,
          ROUND(o."decimalLongitude"::numeric, 1) AS lon_grid
        FROM obis o
        JOIN scientific_names sn ON o.aphiaid = sn.aphiaid
        GROUP BY o.aphiaid, sn."scientificName", lat_grid, lon_grid
      ),
      cooccurrences AS (
        SELECT 
          a."scientificName" AS species_a,
          b."scientificName" AS species_b,
          COUNT(*) AS times_together
        FROM species_locations a
        JOIN species_locations b ON 
          a.lat_grid = b.lat_grid AND
          a.lon_grid = b.lon_grid AND
          a.aphiaid < b.aphiaid
        GROUP BY species_a, species_b
        HAVING COUNT(*) > 5
      )
      SELECT * FROM cooccurrences
      ORDER BY times_together DESC
      LIMIT 20;
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching species co-occurrence:', err);
    res.status(500).json([]);
  }
};

const getSpeciesByName = async (req, res) => {
  const { scientificName } = req.params;
  try {
    const result = await connection.query(
      `
      WITH region_boxes(region_id, min_lat, max_lat, min_lon, max_lon) AS (
        VALUES
          ('northPacific_west',    0.0,   66.5,    120.0,   180.0),
          ('northPacific_east',    0.0,   66.5,   -180.0,  -120.0),
          ('southPacific_west',  -60.0,    0.0,    120.0,   180.0),
          ('southPacific_east',  -60.0,    0.0,   -180.0,   -70.0),
          ('northAtlantic',        0.0,   66.5,    -70.0,    20.0),
          ('southAtlantic',      -60.0,    0.0,    -70.0,    20.0),
          ('indianOcean',        -60.0,   30.0,     20.0,   146.5),
          ('arcticOcean',         66.5,   90.0,   -180.0,   180.0),
          ('southernOcean',      -90.0,  -60.0,   -180.0,   180.0)
      ),
      observations AS (
        SELECT
          o.id,
          sn."scientificName",
          o."eventDate",
          o."decimalLongitude" AS longitude,
          o."decimalLatitude" AS latitude
        FROM scientific_names sn
        JOIN obis o ON o.aphiaid = sn.aphiaid
        WHERE sn."scientificName" ILIKE $1
      ),
      observations_with_region AS (
        SELECT 
          o.*,
          (SELECT rb.region_id 
           FROM region_boxes rb 
           WHERE o.latitude BETWEEN rb.min_lat AND rb.max_lat 
             AND o.longitude BETWEEN rb.min_lon AND rb.max_lon
           LIMIT 1) AS region_id
        FROM observations o
      )
      SELECT * FROM observations_with_region
      WHERE region_id IS NOT NULL
      ORDER BY "eventDate" DESC
      LIMIT 100;
      `,
      [`%${scientificName}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};


const regionBounds = {
  // Arctic Circle @ 66.5° N
  // Equator @ 0° N
  // South Pole @ -90° S
  // North Pole @ 90° N
  // negative coords are for West and South
  // positive coords are for East and North

  northPacific_west: {
    minLat: 0.0,
    maxLat: 66.5,
    minLon: 120.0,
    maxLon: 180.0,
  },
  northPacific_east: {
    minLat: 0.0,
    maxLat: 66.5,
    minLon: -180.0,
    maxLon: -120.0,
  },
  southPacific_west: {
    minLat: -60.0,
    maxLat: 0.0,
    minLon: 120.0,
    maxLon: 180.0,
  },
  southPacific_east: {
    minLat: -60.0,
    maxLat: 0.0,
    minLon: -180.0,
    maxLon: -70.0,
  },
  northAtlantic: {
    minLat: 0.0,
    maxLat: 66.5,
    minLon: -70.0,
    maxLon: 20.0,
  },
  southAtlantic: {
    minLat: -60.0,
    maxLat: 0.0,
    minLon: -70.0,
    maxLon: 20.0,
  },
  indianOcean: {
    minLat: -60.0,
    maxLat: 30.0,
    minLon: 20.0,
    maxLon: 146.5,
  },
  arcticOcean: {
    minLat: 66.5,
    maxLat: 90.0,
    minLon: -180.0,
    maxLon: 180.0,
  },
  southernOcean: {
    minLat: -90.0,
    maxLat: -60.0,
    minLon: -180.0,
    maxLon: 180.0,
  },
};


const getRegionTemperature = async (req, res) => {
  try {
    const result = await connection.query(`
      WITH region_boxes(region_id, min_lat, max_lat, min_lon, max_lon) AS (
        VALUES
          ('northPacific_west',    0.0,   66.5,    120.0,   180.0),
          ('northPacific_east',    0.0,   66.5,   -180.0,  -120.0),
          ('southPacific_west',  -60.0,    0.0,    120.0,   180.0),
          ('southPacific_east',  -60.0,    0.0,   -180.0,   -70.0),
          ('northAtlantic',        0.0,   66.5,    -70.0,    20.0),
          ('southAtlantic',      -60.0,    0.0,    -70.0,    20.0),
          ('indianOcean',        -60.0,   30.0,     20.0,   146.5),
          ('arcticOcean',         66.5,   90.0,   -180.0,   180.0),
          ('southernOcean',      -90.0,  -60.0,   -180.0,   180.0)
      )
      SELECT
        rb.region_id,
        AVG(w.temperature) AS avg_temperature
      FROM wod w
      JOIN region_boxes rb
        ON w.latitude  BETWEEN rb.min_lat AND rb.max_lat
       AND w.longitude BETWEEN rb.min_lon AND rb.max_lon
      GROUP BY rb.region_id;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};

const getRegionSalinityAndPH = async (req, res) => {
  try {
    const result = await connection.query(`
      WITH region_boxes(region_id, min_lat, max_lat, min_lon, max_lon) AS (
        VALUES
          ('northPacific_west',    0.0,   66.5,    120.0,   180.0),
          ('northPacific_east',    0.0,   66.5,   -180.0,  -120.0),
          ('southPacific_west',  -60.0,    0.0,    120.0,   180.0),
          ('southPacific_east',  -60.0,    0.0,   -180.0,   -70.0),
          ('northAtlantic',        0.0,   66.5,    -70.0,    20.0),
          ('southAtlantic',      -60.0,    0.0,    -70.0,    20.0),
          ('indianOcean',        -60.0,   30.0,     20.0,   146.5),
          ('arcticOcean',         66.5,   90.0,   -180.0,   180.0),
          ('southernOcean',      -90.0,  -60.0,   -180.0,   180.0)
      )
      SELECT
        rb.region_id,
        AVG(w.salinity) AS avg_salinity,
        AVG(w.ph)       AS avg_ph
      FROM wod w
      JOIN region_boxes rb
        ON w.latitude  BETWEEN rb.min_lat AND rb.max_lat
       AND w.longitude BETWEEN rb.min_lon AND rb.max_lon
      GROUP BY rb.region_id;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};

const getRegionSpecies = async (req, res) => {
  const { region } = req.params;
  try {
    let query = `
      WITH region_boxes(region_id, min_lat, max_lat, min_lon, max_lon) AS (
        VALUES
          ('northPacific_west',    0.0,   66.5,    120.0,   180.0),
          ('northPacific_east',    0.0,   66.5,   -180.0,  -120.0),
          ('southPacific_west',  -60.0,    0.0,    120.0,   180.0),
          ('southPacific_east',  -60.0,    0.0,   -180.0,   -70.0),
          ('northAtlantic',        0.0,   66.5,    -70.0,    20.0),
          ('southAtlantic',      -60.0,    0.0,    -70.0,    20.0),
          ('indianOcean',        -60.0,   30.0,     20.0,   146.5),
          ('arcticOcean',         66.5,   90.0,   -180.0,   180.0),
          ('southernOcean',      -90.0,  -60.0,   -180.0,   180.0)
      )
      SELECT DISTINCT
        rb.region_id,
        sn."scientificName"
      FROM obis o
      JOIN scientific_names sn
        ON o.aphiaid = sn.aphiaid
      JOIN region_boxes rb
        ON o."decimalLatitude"  BETWEEN rb.min_lat AND rb.max_lat
       AND o."decimalLongitude" BETWEEN rb.min_lon AND rb.max_lon
       
    `;

    // If a specific region is requested, filter by it
    if (region && region !== 'all') {
      query += ` WHERE rb.region_id = $1`;
      query += ` ORDER BY sn."scientificName"`;
      const result = await connection.query(query, [region]);
      res.json(result.rows);
    } else {
      // Otherwise return all regions
      query += ` ORDER BY rb.region_id, sn."scientificName"`;
      const result = await connection.query(query);
      res.json(result.rows);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};

// Update getRegions to handle the split Pacific regions
const getRegions = async (req, res) => {
  try {
    // Return a list of all ocean regions with some special handling for split regions
    const regions = Object.keys(regionBounds).map(region => {
      if (region === 'northPacific_west' || region === 'northPacific_east') {
        return {
          id: region,
          name: 'North Pacific'
        };
      } else if (region === 'southPacific_west' || region === 'southPacific_east') {
        return {
          id: region,
          name: 'South Pacific'
        };
      } else {
        return {
          id: region,
          name: region
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
        };
      }
    });

    // Filter to remove duplicates (since we have east/west regions with same display name)
    const uniqueRegions = regions.filter((region, index, self) =>
      index === self.findIndex((r) => r.name === region.name)
    );

    res.json(uniqueRegions);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
};




// Currently fecthces all species depending on name serached (limited 10 for now but can do lazy pagination later)
const getAllSpecies = async (req, res) => {
  const name = req.query.scientificName ?? '';

  connection.query(`
    SELECT sn.aphiaid AS id, sn."scientificName"
    FROM scientific_names sn
    JOIN obis o ON sn.aphiaid = o.aphiaid
    WHERE sn."scientificName" ILIKE $1
    GROUP BY sn.aphiaid, sn."scientificName"
    LIMIT 10
  `, [`%${name}%`], (err, data) => {
    if (err) {
      console.log('Error:', err);
      res.json([]);
    } else {
      res.json(data.rows);
    }
  });
};








// INTERACTIVE MAP PAGE ROUTE w/ 2 Queries:

const getObisByCoordinates = async (req, res) => {
  const { lat, lng } = req.params;

  try {
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    const normLng = parsedLng < -180 ? parsedLng + 360 :
      parsedLng > 180 ? parsedLng - 360 : parsedLng;

    let selectedRegion = null;

    for (const [regionKey, region] of Object.entries(regionBounds)) {
      if (parsedLat >= region.minLat &&
        parsedLat <= region.maxLat &&
        normLng >= region.minLon &&
        normLng <= region.maxLon) {
        selectedRegion = {
          id: regionKey,
          name: regionKey
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase()),
          bounds: region
        };
        break;
      }
    }

    if (!selectedRegion) {
      return res.status(404).json({ message: "No ocean region found for these coordinates" });
    }

    const obisQuery = `
      WITH region_data AS (
        SELECT $1::text AS region_id, $2::float AS min_lat, $3::float AS max_lat, $4::float AS min_lon, $5::float AS max_lon
      )
      SELECT o.id, sn."scientificName", o."decimalLatitude" AS latitude, o."decimalLongitude" AS longitude, 
             o."dayOfYear", o.sst, o.sss, o.depth
      FROM obis o JOIN scientific_names sn ON o.aphiaid = sn.aphiaid
      JOIN region_data rd ON o."decimalLatitude" BETWEEN rd.min_lat AND rd.max_lat AND 
      o."decimalLongitude" BETWEEN rd.min_lon AND rd.max_lon
      LIMIT 100;
    `;

    const climateQuery = `
      WITH region_data AS (
        SELECT $1::text AS region_id, $2::float AS min_lat, $3::float AS max_lat, $4::float AS min_lon, $5::float AS max_lon
      )
      SELECT AVG(o.sst) AS avg_sst, AVG(o.sss) AS avg_sss, COUNT(*) AS total_observations
      FROM obis o JOIN region_data rd ON o."decimalLatitude" BETWEEN rd.min_lat AND rd.max_lat 
      AND o."decimalLongitude" BETWEEN rd.min_lon AND rd.max_lon
      WHERE o.sst IS NOT NULL OR o.sss IS NOT NULL;
    `;

    const [obisResult, climateResult] = await Promise.all([
      connection.query(obisQuery, [
        selectedRegion.id,
        selectedRegion.bounds.minLat,
        selectedRegion.bounds.maxLat,
        selectedRegion.bounds.minLon,
        selectedRegion.bounds.maxLon
      ]),
      connection.query(climateQuery, [
        selectedRegion.id,
        selectedRegion.bounds.minLat,
        selectedRegion.bounds.maxLat,
        selectedRegion.bounds.minLon,
        selectedRegion.bounds.maxLon
      ])
    ]);

    res.json({
      region: selectedRegion,
      obisEntries: obisResult.rows,
      climate: climateResult.rows[0]
    });
  } catch (err) {
    console.error('Error getting OBIS data by coordinates:', err);
    res.status(500).json({ error: 'Server error fetching data' });
  }
};


// INSIGHTS PAGE ROUTES
const getSpeciesMonthlyTrends = async (req, res) => {
  const { scientificName } = req.params;
  try {
    const result = await connection.query(`
      WITH monthly_counts AS (
        SELECT dl."month", COUNT(*) AS occ_count
        FROM obis o JOIN scientific_names sn ON o.aphiaid = sn.aphiaid
        JOIN date_lookup dl ON o."dayOfYear" = dl."dayOfYear"
        WHERE sn."scientificName" ILIKE $1
        GROUP BY dl."month"
      ),
      monthly_counts_with_prev AS (
        SELECT mc."month", mc.occ_count,
          CASE
            WHEN LAG(mc.occ_count, 1, NULL) OVER (ORDER BY mc."month") IS NULL THEN NULL
            WHEN LAG(mc.occ_count, 1, NULL) OVER (ORDER BY mc."month") = 0 THEN NULL
            ELSE (mc.occ_count - LAG(mc.occ_count, 1, NULL) OVER (ORDER BY mc."month")) * 100.0 / 
                 LAG(mc.occ_count, 1, NULL) OVER (ORDER BY mc."month")
          END AS pct_change
        FROM monthly_counts mc
      ),
      monthly_temp AS (
        SELECT dl."month", AVG(w.temperature) AS avg_wod_temp
        FROM wod_2015 w JOIN date_lookup dl ON w."dayOfYear" = dl."dayOfYear"
        GROUP BY dl."month"
      )
      SELECT mc."month", mc.occ_count, mc.pct_change, mt.avg_wod_temp
      FROM monthly_counts_with_prev mc LEFT JOIN monthly_temp mt ON mc."month" = mt."month"
      ORDER BY mc."month";
    `, [`%${scientificName}%`]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching monthly trends:', err);
    res.status(500).json([]);
  }
};






const getSpeciesShifts = async (req, res) => {
  const { 
    minCount = 10, 
    oldStartDate = '2015-01-01', 
    oldEndDate = '2015-06-30', 
    newStartDate = '2015-07-01', 
    newEndDate = '2015-12-31', 
    scientificName 
  } = req.query;
  
  try {
    if (!scientificName) {
      return res.status(400).json({ error: 'Scientific name is required' });
    }

    console.log(`Processing shifts query for: ${scientificName}`);
    console.log(`Time periods: ${oldStartDate} to ${oldEndDate} and ${newStartDate} to ${newEndDate}`);
    console.log(`Minimum count: ${minCount}`);

    const getDayOfYear = (dateString) => {
      try {
        // edge cases for dates
        if (dateString === '2015-01-01') {
          console.log('Detected January 1st, returning day 1');
          return 1;
        }
        if (dateString === '2015-12-31') {
          console.log('Detected December 31st, returning day 365');
          return 365;
        }
        const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
        const specifiedDate = new Date(2015, month - 1, day);
        const firstDayOfYear = new Date(2015, 0, 1);
        const diff = specifiedDate - firstDayOfYear;
        const oneDay = 24 * 60 * 60 * 1000;
        const dayOfYear = Math.floor(diff / oneDay) + 1;
        
        console.log(`Converted ${dateString} to day of year: ${dayOfYear}`);
        return dayOfYear;
      } catch (err) {
        console.error(`Error converting date ${dateString}: ${err.message}`);
        return 1;
      }
    };

    const oldStart = getDayOfYear(oldStartDate);
    const oldEnd = getDayOfYear(oldEndDate);
    const newStart = getDayOfYear(newStartDate);
    const newEnd = getDayOfYear(newEndDate);

    console.log(`Query will use day values: ${oldStart}-${oldEnd} and ${newStart}-${newEnd}`);
    if (oldStart > oldEnd) {
      console.log(`Warning: First period start day (${oldStart}) is after end day (${oldEnd}). Swapping these values.`);
      const temp = oldStart;
      oldStart = oldEnd;
      oldEnd = temp;
    }

    const query = `
      WITH first_half_observations AS (
        SELECT o.aphiaid, COUNT(*) as count, AVG(o."decimalLatitude") as avg_lat, AVG(o."decimalLongitude") as avg_lon
        FROM obis o JOIN scientific_names sn ON o.aphiaid = sn.aphiaid
        WHERE o."dayOfYear" BETWEEN $1 AND $2 AND sn."scientificName" ILIKE $6
        GROUP BY o.aphiaid
        HAVING COUNT(*) >= $5
      ),
      second_half_observations AS (
        SELECT o.aphiaid, COUNT(*) as count, AVG(o."decimalLatitude") as avg_lat, AVG(o."decimalLongitude") as avg_lon
        FROM obis o
        JOIN scientific_names sn ON o.aphiaid = sn.aphiaid
        WHERE o."dayOfYear" BETWEEN $3 AND $4 AND sn."scientificName" ILIKE $6
        GROUP BY o.aphiaid
        HAVING COUNT(*) >= $5
      ),
      species_with_both_halves AS (
        SELECT fh.aphiaid,fh.avg_lat as first_half_lat, fh.avg_lon as first_half_lon, sh.avg_lat as second_half_lat, 
        sh.avg_lon as second_half_lon, fh.count as first_half_count, sh.count as second_half_count
        FROM first_half_observations fh JOIN second_half_observations sh ON fh.aphiaid = sh.aphiaid
      )
      SELECT sb.aphiaid as id, sb.first_half_lat, sb.first_half_lon, sb.second_half_lat, sb.second_half_lon, sb.first_half_count, sb.second_half_count,
        -- Haversine formula to calculate distance in kilometers
        2 * 6371 * ASIN(
          SQRT(
            POW(SIN(RADIANS(sb.second_half_lat - sb.first_half_lat) / 2), 2) + 
            COS(RADIANS(sb.first_half_lat)) * COS(RADIANS(sb.second_half_lat)) * 
            POW(SIN(RADIANS(sb.second_half_lon - sb.first_half_lon) / 2), 2)
          )
        ) as "shiftDist"
      FROM species_with_both_halves sb
      ORDER BY "shiftDist" DESC
      LIMIT 100;
    `;
    
    result = await connection.query(query, [oldStart, oldEnd, newStart, newEnd, minCount, `%${scientificName}%`]);
    
    console.log(`Found ${result.rows.length} results`);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching species shifts:', err);
    res.status(500).json([]);
  }
};
router.get('/test', test);
router.get('/species/most-observed', getMostObservedSpecies);
router.get('/species/name/:scientificName', getSpeciesByName);
router.get('/regions', getRegions);
router.get('/regions/temperature', getRegionTemperature);
router.get('/regions/water-properties', getRegionSalinityAndPH);
router.get('/regions/species/:region', getRegionSpecies);
router.get('/regions/species', getRegionSpecies);
router.get('/obis/coordinates/:lat/:lng', getObisByCoordinates);
router.get('/species/habitat-counts', getMarineBrackishCounts);
// router.get('/species/by-month', getSpeciesByMonth);
router.get('/search_species', searchSpecies);
router.get('/species/monthly-trends/:scientificName', getSpeciesMonthlyTrends);
router.get('/species/shifts', getSpeciesShifts);
router.get('/species/cooccurrence', getSpeciesCooccurrence);
router.get('/species/random', getRandomSpecies);
router.get('/species/search', getAllSpecies);
router.get('/species/details/:scientificName', detailedSpeciesInfo);

module.exports = {
  router,
  test,
  getMostObservedSpecies,
  getSpeciesByName,
  getRegionTemperature,
  getRegionSalinityAndPH,
  getRegionSpecies,
  getRegions,
  getObisByCoordinates,
  getAllSpecies,
  getRandomSpecies,
  getSpeciesShifts,
  getMarineBrackishCounts,
  // getSpeciesByMonth,
  getSpeciesCooccurrence,
  searchSpecies
};