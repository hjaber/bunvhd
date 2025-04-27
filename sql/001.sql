DROP TABLE IF EXISTS cities;

CREATE TABLE cities (
    city_id SERIAL PRIMARY KEY, 
    city_name character varying(100) NOT NULL,
    local_name character varying(100),
    country character varying(100) NOT NULL,
    continent character varying(50) NOT NULL,
    population integer,
    language_spoken character varying(100)
);

-- Insert the data into the cities table
INSERT INTO cities (city_name, local_name, country, continent, population, language_spoken) VALUES
('Tokyo', 'Tokyo', 'Japan', 'Asia', 37435191, 'Japanese'),
('London', 'London', 'United Kingdom', 'Europe', 8982000, 'English'),
('New York', 'New York', 'United States', 'North America', 8335897, 'English'),
('Paris', 'Paris', 'France', 'Europe', 2140526, 'French'),
('Rome', 'Roma', 'Italy', 'Europe', 2872800, 'Italian'),
('Sydney', 'Sydney', 'Australia', 'Australia', 5312163, 'English'),
('Cairo', 'Al-Qāhirah', 'Egypt', 'Africa', 10230000, 'Arabic'),
('Mumbai', 'Mumbai', 'India', 'Asia', 12478447, 'Hindi'),
('Toronto', 'Toronto', 'Canada', 'North America', 2930000, 'English'),
('Mexico City', 'Ciudad de México', 'Mexico', 'North America', 9209944, 'Spanish'),
('Berlin', 'Berlin', 'Germany', 'Europe', 3645000, 'German'),
('Madrid', 'Madrid', 'Spain', 'Europe', 3223000, 'Spanish'),
('Istanbul', 'İstanbul', 'Turkey', 'Asia', 15460000, 'Turkish'),
('Bangkok', 'Krung Thep Maha Nakhon', 'Thailand', 'Asia', 10539000, 'Thai'),
('Rio de Janeiro', 'Rio de Janeiro', 'Brazil', 'South America', 6748000, 'Portuguese'),
('Buenos Aires', 'Buenos Aires', 'Argentina', 'South America', 3075000, 'Spanish'),
('Johannesburg', 'Johannesburg', 'South Africa', 'Africa', 5635000, 'English'),
('Moscow', 'Moskva', 'Russia', 'Europe', 12635000, 'Russian'),
('Seoul', 'Seoul', 'South Korea', 'Asia', 9776000, 'Korean'),
('Los Angeles', 'Los Angeles', 'United States', 'North America', 3971000, 'English');

