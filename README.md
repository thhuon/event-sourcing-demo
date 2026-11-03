# Shopping Cart — Event Sourcing + CQRS with KurrentDB

A small shopping cart that stores **every change as an event** in KurrentDB (write side) and serves reads from a **PostgreSQL read model** built by a projector (read side). A one-page demo UI shows both sides at the same time, so you can watch a command become an event and the event become a row in the read model.

Based on the [`from_crud_to_eventsourcing`](https://github.com/oskardudycz/EventSourcing.NodeJS/tree/main/samples/from_crud_to_eventsourcing) sample by Oskar Dudycz ([oskardudycz/EventSourcing.NodeJS](https://github.com/oskardudycz/EventSourcing.NodeJS); original README: [README.original.md](README.original.md)). The sample ships a CRUD version and an event-sourced version of the same cart; this repo runs the event-sourced one and adds the demo UI.

## Architecture

```text
            COMMAND (POST / DELETE / PUT)                              QUERY (GET)
Demo UI ──────────────────────► app (Node.js :5000) ◄─────────────────────────────────┐
(:5000)                           │ 1. read the cart's stream                          │
                                  │ 2. replay events → current state                   │
                                  │ 3. check business rules → new event                │
                                  │ 4. append with expected revision                   │
                                  ▼                                                    │
        ┌──── KurrentDB :2114 (WRITE SIDE) ────┐                ┌── PostgreSQL :5436 (READ SIDE) ──┐
        │ shopping_cart-<id>   one stream/cart │                │ cart, cart_item     (read model) │
        │ $all                 global order    │                │ subscription_checkpoint          │
        └──────────────────┬───────────────────┘                └────────────────▲─────────────────┘
                           │ catch-up subscription to $all                       │
                           └──────────────► projector (inside app) ──────────────┘
```

| Part | File | Role |
|---|---|---|
| Aggregate | [src/eventsourced/shoppingCarts/shoppingCart.ts](src/eventsourced/shoppingCarts/shoppingCart.ts) | Event types, `getShoppingCart` (replay events → state), command handlers (check rules → return an event) |
| Command + query API | [src/eventsourced/shoppingCarts/routes.ts](src/eventsourced/shoppingCarts/routes.ts) | Commands write to KurrentDB, the revision travels in `ETag` / `If-Match`; the query reads PostgreSQL |
| Append / read stream | [src/eventsourced/core/commandHandling.ts](src/eventsourced/core/commandHandling.ts) | `create` (stream must not exist yet), `update` (read stream → handle → append with `streamState`) |
| Projector | [src/eventsourced/shoppingCarts/shoppingCartDetails.ts](src/eventsourced/shoppingCarts/shoppingCartDetails.ts), [src/eventsourced/core/subscriptions.ts](src/eventsourced/core/subscriptions.ts) | Subscribes to `$all`, updates `cart` / `cart_item`, stores a checkpoint; the `revision` column makes it skip events it already applied |
| Price list | [src/eventsourced/shoppingCarts/productItem.ts](src/eventsourced/shoppingCarts/productItem.ts) | 4 fixed products; the server sets the price when an item is added |
| CRUD version (for comparison) | [src/crud/shoppingCarts/routes.ts](src/crud/shoppingCarts/routes.ts) | One upsert endpoint that overwrites the whole cart — not started in the demo |
| Demo UI | [public/index.html](public/index.html), [src/eventsourced/demo/routes.ts](src/eventsourced/demo/routes.ts) | Three columns (command side, event store, read model) and projector controls |

## Run

Requirements: Docker with Docker Compose v2. Ports `5000`, `2114` and `5436` must be free.

```bash
git clone https://github.com/thhuon/event-sourcing-demo.git
cd event-sourcing-demo
docker compose up -d --build
docker compose ps          # kurrentdb should be "healthy", app "Up"
docker compose logs -f app # wait for "server up listening" and "Subscription is running"
```

The first start pulls the images and installs npm packages, so it takes a few minutes. PostgreSQL runs the migrations in [src/eventsourced/migrations](src/eventsourced/migrations) automatically the first time its volume is created.

### URLs

| What | URL / connection | Notes |
|---|---|---|
| **Demo UI** | http://localhost:5000 | Start here |
| **KurrentDB Web UI** | http://localhost:2114 | Opens the cluster page. Use **Navigator** (http://localhost:2114/ui/navigator) to browse streams such as `shopping_cart-<id>` and `$all`. Insecure mode, no login |
| KurrentDB client connection | `kurrentdb://localhost:2114?tls=false` | gRPC, used by the app |
| **PostgreSQL** | `postgres://postgres:postgres@localhost:5436/postgres` | Host `localhost`, port `5436`, database `postgres`, user `postgres`, password `postgres`, schema **`ecommerce`** |
| Query API | http://localhost:5000/v2/shopping-carts/{cartId} | Read model for one cart (JSON) |
| pgAdmin (optional) | http://localhost:5050 | `docker compose --profile tools up -d`. Register a server with host `postgres`, port `5432`, user/password `postgres` |

Look at the read model from a terminal:

```bash
docker compose exec postgres psql -U postgres -c 'SELECT "sessionId", status, revision FROM ecommerce.cart;'
docker compose exec postgres psql -U postgres -c 'SELECT "cartId", "productId", quantity, price FROM ecommerce.cart_item;'
docker compose exec postgres psql -U postgres -c 'SELECT * FROM ecommerce.subscription_checkpoint;'
```

### Stop and reset

```bash
docker compose down      # stop, keep events and read model
docker compose down -v   # stop and delete all data (events, read model, checkpoint)
```

## What the demo UI shows

The page is the whole CQRS + Event Sourcing loop on one screen. It refreshes every second. UI labels are in Vietnamese; the English meaning is given in brackets below.

| Column | Shows | Why it matters |
|---|---|---|
| **① Command side** | Product list with *+ Thêm* (add), the current cart with *− 1* (remove one), *+ Giỏ mới* (new cart) and *✓ Xác nhận giỏ* (confirm cart). Every click sends a **command** to the API. The log at the bottom says which event was appended and the new stream revision, or why the command was **rejected** (`409` business rule, `412` version conflict) — in that case no event is written. The cart contents in this column are read from the **read model**, not from the event store. | Commands only change state; they do not return screen data. |
| **② Event store — KurrentDB** | The latest events from `$all`, newest first: event type, stream (`shopping_cart-<id>`), stream revision and data. Events the projector has not processed yet are **orange** (*chưa được project* — not projected yet). *Chỉ stream của giỏ hiện tại* filters to the current cart's stream; *Mở KurrentDB UI* opens Navigator. | The event log is append-only and is the source of truth. |
| **③ Read model — PostgreSQL** | Projector status, checkpoint and lag (events not yet projected), the `cart` / `cart_item` rows, and three buttons: *⏸ Dừng projector* (stop), *▶ Chạy projector* (run), *🗑 Xóa read model* (delete read model). Click a row to make that cart the current one. | The read side is derived data. It can lag behind, and it can be rebuilt from the events at any time. |

The *Lần gửi tới dùng version cũ* checkbox (next send uses an old version) makes the next command send `If-Match` with the previous revision, as if another browser tab had changed the cart first.

## Demo script

1. **What CRUD loses**: The CRUD version ([src/crud](src/crud)) keeps only the final cart; adding and then removing an item leaves no trace. The event-sourced version keeps both events.
2. **Append-only events**: *+ Giỏ mới* → *+ Thêm* Áo thun (T-shirt) and Giày sneaker → *− 1* on Áo thun. Column ② shows 4 events with `rev 0..3`; nothing is updated or deleted. Open the stream in KurrentDB Navigator to see the same events.
3. **CQRS and eventual consistency**: *⏸ Dừng projector*, then add a product → the event appears in ② in orange, but the cart in ① and the table in ③ do not change. *▶ Chạy projector* → the read model catches up.
4. **Rejected command**: *✓ Xác nhận giỏ*, then add another product → `409 CART_IS_NOT_OPENED` and no new event in ②. Confirming an empty cart → `409 NO_PRODUCTS_ITEMS`.
5. **Optimistic concurrency**: Tick *Lần gửi tới dùng version cũ*, then add a product → `412 WRONG_EXPECTED_VERSION`.
6. **Events are the source of truth**: *🗑 Xóa read model* → table ③ is empty while ② still has every event. *▶ Chạy projector* → it replays `$all` from the start and the read model comes back exactly as before.

## API

| Command / query | HTTP | Event | Rule (rejected → no event) |
|---|---|---|---|
| Open cart | `POST /v2/shopping-carts` | `shopping-cart-opened` | Stream does not exist yet |
| Add product | `POST /v2/shopping-carts/:id/product-items` body `{productId, quantity}` | `product-item-added-to-shopping-cart` | Cart is open; product is in the price list |
| Remove product | `DELETE /v2/shopping-carts/:id/product-items?productId=&quantity=` | `product-item-removed-from-shopping-cart` | Cart is open; the cart holds that many items |
| Confirm cart | `PUT /v2/users/:userId/shopping-carts/:id` body `{line1?, line2?, content?}` | `shopping-cart-confirmed` | Cart is open; cart is not empty |
| Get cart | `GET /v2/shopping-carts/:id` | — (query) | Reads `cart` + `cart_item` |

Every command except *Open cart* must send `If-Match: W/"<revision>"`; the response returns the next revision in `ETag`. Errors come back as JSON `{error, message}`.

```bash
ID=$(curl -s -XPOST localhost:5000/v2/shopping-carts | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -i -XPOST localhost:5000/v2/shopping-carts/$ID/product-items \
  -H 'Content-Type: application/json' -H 'If-Match: W/"0"' -d '{"productId":1,"quantity":1}'
curl -s localhost:5000/v2/shopping-carts/$ID
```

Demo-only endpoints used by the UI: `GET /demo/state`, `POST /demo/projector/stop`, `POST /demo/projector/start`, `POST /demo/read-model/reset`.

## KurrentDB and EventStoreDB

KurrentDB is the new name of EventStoreDB: Event Store Ltd renamed itself Kurrent and, from version 25.0, ships the same database as KurrentDB. The storage model (streams, `$all`, expected revision, subscriptions, projections) is unchanged. What changes for this repo:

| | EventStoreDB (original sample) | KurrentDB (this repo) |
|---|---|---|
| Docker image | `eventstore/eventstore:24.10` | `docker.kurrent.io/kurrent-latest/kurrentdb:26.1` |
| Config variables | `EVENTSTORE_*` | `KURRENTDB_*` |
| Node.js client | `@eventstore/db-client`, `EventStoreDBClient` | `@kurrent/kurrentdb-client`, `KurrentDBClient` |
| Connection string | `esdb://…` | `kurrentdb://…` |
| Append option | `expectedRevision` | `streamState` |
| Web UI | `/web/index.html` | `/ui/navigator` (new UI) |

## Changes from the original sample

- **KurrentDB** instead of EventStoreDB (see the table above).
- **The projector processes events one at a time** (`for await` instead of `on('data', async …)`). In the original, handlers of consecutive events could overlap; during a replay the `revision = streamRevision - 1` check in the projection would then skip events.
- **Removed `throwOnAppendFailure=false`** from the connection string. With it, an append with a stale revision did not throw, so the API answered `200` although no event was written.
- **Added** a price list with 4 products (the original priced everything at 100), projector controls (stop / start / reset), JSON errors (`409` business rules, `412` version conflict), the `app` service in Docker Compose and automatic migrations.
- `uuid` was used without being declared in `package.json` (it came in through the old client); replaced by Node's `crypto.randomUUID`.
- Ports: KurrentDB `2114`, PostgreSQL `5436`, so the demo does not clash with other local projects.
