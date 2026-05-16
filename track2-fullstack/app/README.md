# FarmTracker

A livestock record management application for tracking animals, paddock assignments, health events, and weight measurements.

## Requirements

- Node.js 22.5+ (uses built-in `node:sqlite`)

## Setup

```bash
cd track2-fullstack/app/backend
npm install
node seed.js
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Running tests

The test suite starts its own server and temporary SQLite database:

```bash
cd track2-fullstack/app/backend
npm test
```

Note: Node's built-in SQLite support is experimental, so you may see an `ExperimentalWarning` during tests.

## Project structure

```
app/
├── backend/
│   ├── server.js          # Express app entry point
│   ├── db.js              # Database connection and schema
│   ├── routes/
│   │   ├── animals.js     # Animal endpoints
│   │   └── paddocks.js    # Paddock endpoints
│   ├── test/
│   │   ├── api.test.js    # Basic integration tests
│   │   ├── p0.test.js     # P0 correctness/security regression tests
│   │   ├── p1.test.js     # P1 API consistency regression tests
│   │   ├── p2.test.js     # P2 perf/maintainability regression tests
│   │   └── weights_logging.test.js # Weight logging acceptance + data model tests
│   ├── seed.js            # Seed script (run once after install)
│   └── package.json
└── frontend/
    ├── index.html         # Paddocks overview
    ├── animals.html       # Animal list
    ├── animal-detail.html # Animal detail + health events + weight history
    ├── app.js             # Shared fetch utilities
    └── styles.css
```

## API reference

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/paddocks | List all paddocks |
| POST | /api/paddocks | Create a paddock |
| GET | /api/paddocks/:id | Get a paddock |
| GET | /api/animals | List animals (`page`, `limit` query params) |
| POST | /api/animals | Create an animal |
| GET | /api/animals/:id | Get an animal |
| PUT | /api/animals/:id | Update an animal |
| DELETE | /api/animals/:id | Delete an animal |
| GET | /api/animals/:id/health-events | List health events |
| POST | /api/animals/:id/health-events | Log a health event |
| GET | /api/animals/:id/weights | List weight history (date desc) |
| POST | /api/animals/:id/weights | Log a weight measurement |

## Weight logging feature

The animal detail page (`/animal-detail.html?id=...`) includes a **Weight History** section that:

- Lists all recorded weights (date, weight, notes)
- Shows the latest weight prominently
- Provides a form to log new weight measurements
