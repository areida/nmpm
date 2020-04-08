# New Metal Playlist Maker

## Requirements
- Node.js 10+
- Docker or Docker for Mac/Windows
- Spotify account

## Setup
1. Create a new application at https://developer.spotify.com/dashboard/applications
1. Get the Client ID and Client Secret
1. Add `https://localhost:88/authorize` to your application's Redirect URIs

## Installation
1. Rename `example.env` to `.env`
1. Set the `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` values in `.env`
1. Run `docker-compose up`
1. Visit http://localhost:88
1. Authorize the app

## Use
- `node bin/build-playlist` Scrapes for music released today and adds it to a new playlist
  - `-a, --auth` Override auth token
  - `-d, --dates` List of dates (YYYY-MM-DD) to scrape for
  - `-g, --genre` Genre filter
  - `-p, --playlist` ID of playlist to add tracks to
- `node bin/update-db` Scrapes for music release this month and adds it to the redis database
  - `-a, --auth` Override auth token
  - `-m, --month` The month (YYYY-MM) to scrape for
