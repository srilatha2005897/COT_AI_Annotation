# AnnotateAI

Label images for object detection, without doing all the work by hand.

You upload photos, YOLOv8 draws the first set of boxes, and you fix whatever it
got wrong. When you're happy, export the whole project as a YOLO dataset you can
train on.

Built with FastAPI on the backend and React on the frontend.

**Want to run it? → [SETUP.md](SETUP.md)**

---

## What it does

- **Sign in** — email and password, with `user` and `admin` roles.
- **Projects** — each project holds its own images and labels, and belongs to
  the person who made it. You only ever see your own work; admins can see
  everyone's. Two people can each have a project called "Road signs".
- **Upload** — one image, a batch, or a whole folder of any size. Big folders
  are sent in chunks of 20 with a progress bar, and anything that can't be used
  is listed by name instead of being dropped silently.
- **Auto-detect** — YOLOv8 finds objects as soon as you upload. You can set how
  confident it has to be before it draws a box.
- **Edit boxes** — drag, resize, relabel and delete on a canvas. `Ctrl/Cmd+Z`
  undoes, arrow keys nudge, `Del` removes, `Ctrl/Cmd+Enter` saves.
- **Work through a project** — "Save & next" moves you along image by image.
- **See your stats** — how many images are done, and which classes show up most.
- **Export** — download the project in whichever format your training code
  wants: YOLO, COCO JSON, Pascal VOC or CSV. Pick your train/val/test split, and
  optionally leave out anything nobody has reviewed yet.
- **Admin view** — a list of every account.

---

## Run it

Mac or Linux:

```bash
./start.sh
```

Windows:

```cmd
start.bat
```

Then open <http://127.0.0.1:5173>.

The script sets everything up the first time, so the first run takes a few
minutes. [SETUP.md](SETUP.md) covers doing it by hand and what to do when
something breaks.

---

## Settings

Everything has a sensible default, so you don't need to configure anything to
try it out. To change something, make a `backend/.env` file:

```
TOKEN_SECRET=some-long-random-string
ADMIN_SETUP_KEY=my-secret-key
CONFIDENCE_THRESHOLD=0.35
```

The full list of options lives in `backend/app/core/config.py`. The ones you're
most likely to touch:

| Setting | Default | What it does |
| --- | --- | --- |
| `CONFIDENCE_THRESHOLD` | `0.50` | How sure YOLO must be to draw a box |
| `YOLO_MODEL` | `yolov8n.pt` | Which weights file to use |
| `DATABASE_URL` | `sqlite:///./annotation.db` | Where data is stored |
| `MAX_UPLOAD_MB` | `50` | Biggest single image |
| `MAX_BATCH_FILES` | `100` | Most images in one request (not per project) |
| `TOKEN_SECRET` | dev value | Signs login sessions |
| `ADMIN_SETUP_KEY` | dev value | Needed to make the first admin |

**Before you put this on a real server:** set your own `TOKEN_SECRET` and
`ADMIN_SETUP_KEY`. Generate them with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

With `ENVIRONMENT=production` the app refuses to start if you left the
development values in place.

---

## Layout

```
backend/
  app/
    main.py        starts the app
    api/           all the HTTP endpoints
    core/          settings, database, logging
    models/        database tables
    schemas/       request and response shapes
    services/      auth, YOLO detection, annotation logic
  tests/           pytest suite
  alembic/         database migrations (deployment only)

frontend/
  src/
    App.jsx        routing and shared state
    api.js         every call to the backend
    pages/         one file per screen
    components/    the canvas editor, sidebar, shared widgets
    lib/           date helpers, the COCO class list
    styles/        stylesheets shared by several screens
  e2e/             browser smoke test

start.sh / start.bat    run both servers locally
docker-compose.yml      deployment
```

---

## Exporting a dataset

Go to **Export**, pick a project, pick a format, and download the ZIP.

| Format | What's in the ZIP | Use it with |
| --- | --- | --- |
| **YOLO** | `images/`, `labels/`, `data.yaml`, `classes.txt`, `setup_paths.py` | Ultralytics YOLOv5/v8/v11 |
| **COCO** | `images/`, `annotations/instances_{train,val,test}.json` | Detectron2, MMDetection, torchvision |
| **Pascal VOC** | `JPEGImages/`, `Annotations/*.xml`, `ImageSets/Main/` | older detectors, labelImg |
| **CSV** | `images/`, `annotations.csv` | pandas, spreadsheets, quick checks |

You choose how much goes to validation and test. The split is worked out from
the project id, so exporting the same project twice gives you the same split —
important, because a reshuffle between runs quietly leaks validation images into
training. All four formats agree on the split, so you can switch format without
changing which image is where.

Box coordinates are clipped to the image in every format. A box drawn over the
edge of a photo is normal; a *label* describing a region outside the image is
not, and training tools reject those.

### Training on a YOLO export

```bash
unzip annotateai_yolo_project_1_u1.zip -d dataset
cd dataset
python setup_paths.py
yolo detect train data=data.yaml model=yolov8n.pt epochs=50 imgsz=640
```

Run `setup_paths.py` first. Ultralytics resolves a relative `path:` against its
own global datasets directory rather than the folder `data.yaml` is sitting in,
so without an absolute path it looks in the wrong place and says
"Dataset images not found". The script just writes the folder's real location
into `data.yaml`.

---

## The API

Everything sits under `/api`, and every route except register, login and health
needs you to be signed in.

Start the backend and open <http://127.0.0.1:8000/docs> for the full, live list
you can click through and try.

---

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

23 tests, and they're quick because YOLO is stubbed out.

For the browser test (both servers must be running):

```bash
cd frontend
npx playwright install chromium   # once
npm run test:e2e
```

Frontend code is formatted with `npm run format` and checked with `npm run lint`.

---

## Deploying

You don't need any of this to run it locally.

```bash
cp .env.example .env       # put real secrets in it
docker compose up --build
```

That gives you the frontend on <http://localhost:3000> and the backend on
<http://localhost:8000>, backed by PostgreSQL instead of SQLite.

Two things to remember: put it behind HTTPS and set `AUTH_COOKIE_SECURE=true`,
and keep `WEB_CONCURRENCY` low if the server has no GPU, because every worker
loads its own copy of the model.

The container runs `alembic upgrade head` on start. If you are upgrading a
database that predates project ownership, that migration hands every existing
project and image to the earliest account — check who ended up with what before
letting people back in.

## Role-based access

The application supports four account types:

- **User** — can view the shared project list and project/image data. Project editing, uploads, annotation changes, and deletion are blocked.
- **Annotator** — can create projects, upload images, run detection, and edit/save annotations for projects they own.
- **Team Lead** — can view all projects and annotation results in the workspace, but has view-only access to project editing.
- **Admin** — full access to all projects and administration features.

The role selected on Login is validated by the backend against the authenticated account. The same four roles are available on Registration; Admin registration remains protected by the existing admin setup-key flow.

Role restrictions are enforced in both the React UI and FastAPI API, so hiding a button is not the only security control.
