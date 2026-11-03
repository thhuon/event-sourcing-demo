# Shopping Cart — Event Sourcing + CQRS

Demo giỏ hàng dựa trên sample [`from_crud_to_eventsourcing`](https://github.com/oskardudycz/EventSourcing.NodeJS/tree/main/samples/from_crud_to_eventsourcing) của Oskar Dudycz (repo [oskardudycz/EventSourcing.NodeJS](https://github.com/oskardudycz/EventSourcing.NodeJS), README gốc: [README.original.md](README.original.md)). Sample có **hai bản cùng chức năng**: Bản CRUD lưu trạng thái cuối của giỏ, bản Event-Sourced lưu từng thay đổi thành event. Repo này chạy bản Event-Sourced và thêm một trang UI để demo.

```
                 COMMAND (POST / DELETE / PUT)                        QUERY (GET)
UI (:5000) ───────────────► app (Node :5000) ◄────────────────────────────────────┐
                              │ readStream → replay → decide                       │
                              │ appendToStream(expectedRevision)                   │
                              ▼                                                    │
         ┌──── EventStoreDB :2114 (WRITE) ────┐                ┌── PostgreSQL :5436 (READ) ──┐
         │ shopping_cart-<id>  (1 stream/giỏ) │                │ cart, cart_item (read model)│
         │ $all                (thứ tự chung) │                │ subscription_checkpoint     │
         └─────────────────┬──────────────────┘                └──────────────▲──────────────┘
                           │ subscribeToAll (catch-up)                        │
                           └──────────► projector (trong app) ────────────────┘
```

| Thành phần | File | Vai trò |
|---|---|---|
| Aggregate | [src/eventsourced/shoppingCarts/shoppingCart.ts](src/eventsourced/shoppingCarts/shoppingCart.ts) | Events, `getShoppingCart` (replay events → state), các command handler (kiểm tra quy tắc → trả về event) |
| Command + Query API | [src/eventsourced/shoppingCarts/routes.ts](src/eventsourced/shoppingCarts/routes.ts) | Command ghi EventStoreDB, version đi qua header `ETag` / `If-Match`; query đọc Postgres |
| Append / đọc stream | [src/eventsourced/core/commandHandling.ts](src/eventsourced/core/commandHandling.ts) | `create` (stream phải chưa tồn tại), `update` (đọc stream → handle → append với `expectedRevision`) |
| Projector | [src/eventsourced/shoppingCarts/shoppingCartDetails.ts](src/eventsourced/shoppingCarts/shoppingCartDetails.ts), [src/eventsourced/core/subscriptions.ts](src/eventsourced/core/subscriptions.ts) | Subscribe `$all`, cập nhật `cart` / `cart_item`, lưu checkpoint; bỏ qua event đã xử lý nhờ cột `revision` |
| Bảng giá | [src/eventsourced/shoppingCarts/productItem.ts](src/eventsourced/shoppingCarts/productItem.ts) | 4 sản phẩm cố định; giá được hệ thống gán khi thêm vào giỏ |
| Bản CRUD (để so sánh) | [src/crud/shoppingCarts/routes.ts](src/crud/shoppingCarts/routes.ts) | Một endpoint upsert ghi đè toàn bộ giỏ — không chạy trong demo |
| UI demo | [public/index.html](public/index.html), [src/eventsourced/demo/routes.ts](src/eventsourced/demo/routes.ts) | 3 cột: Command side · Event store · Read model; nút dừng/chạy projector, xóa read model |

## Events

Stream: `shopping_cart-<uuid>` — mỗi giỏ một stream. `revision` bắt đầu từ 0.

| Command | HTTP | Event | Quy tắc (bị từ chối → không có event) |
|---|---|---|---|
| Mở giỏ | `POST /v2/shopping-carts` | `shopping-cart-opened` | Stream chưa tồn tại |
| Thêm sản phẩm | `POST /v2/shopping-carts/:id/product-items` | `product-item-added-to-shopping-cart` | Giỏ đang mở; sản phẩm có trong bảng giá |
| Bớt sản phẩm | `DELETE /v2/shopping-carts/:id/product-items?productId=&quantity=` | `product-item-removed-from-shopping-cart` | Giỏ đang mở; trong giỏ có đủ số lượng |
| Xác nhận giỏ | `PUT /v2/users/:userId/shopping-carts/:id` | `shopping-cart-confirmed` | Giỏ đang mở; giỏ không rỗng |
| Xem giỏ | `GET /v2/shopping-carts/:id` | — (query) | Đọc `cart` + `cart_item` |

Mọi command trừ "Mở giỏ" phải gửi `If-Match: W/"<revision>"`. Nếu stream đã có event mới hơn → `412 WRONG_EXPECTED_VERSION` (optimistic concurrency).

## Chạy

```bash
docker compose up -d --build
```

- UI demo: http://localhost:5000
- EventStoreDB Web UI: http://localhost:2114 (Stream Browser → `shopping_cart-…`)
- PostgreSQL: `localhost:5436` (user `postgres` / pass `postgres`, schema `ecommerce`)
- pgAdmin (tùy chọn): `docker compose --profile tools up -d` → http://localhost:5050

Dừng: `docker compose down` (thêm `-v` để xóa luôn events và read model).

## Kịch bản demo

1. **CRUD mất gì**: Bản CRUD ([src/crud](src/crud)) chỉ giữ trạng thái cuối của giỏ — thêm rồi bớt một món thì không còn dấu vết. Bản ES giữ lại cả hai events.
2. **Append-only**: Giỏ mới → thêm Áo thun, Giày → bớt Áo thun. Cột ② có 4 events, `rev 0..3`; không event nào bị sửa hay xóa.
3. **CQRS + eventual consistency**: Bấm ⏸ *Dừng projector*, thêm một sản phẩm → event xuất hiện ở ② (màu cam, *chưa được project*), nhưng giỏ ở ① và bảng ③ chưa đổi. Bấm ▶ → read model bắt kịp.
4. **Command bị từ chối**: *Xác nhận giỏ* → thêm sản phẩm nữa → `409 CART_IS_NOT_OPENED`, cột ② không có event mới. Giỏ rỗng mà xác nhận → `409 NO_PRODUCTS_ITEMS`.
5. **Optimistic concurrency**: Tick *Lần gửi tới dùng version cũ* rồi thêm sản phẩm → `412 WRONG_EXPECTED_VERSION`.
6. **Events là source of truth**: 🗑 *Xóa read model* → bảng ③ trống, ② vẫn đủ events. ▶ *Chạy projector* → projector replay `$all` từ đầu, read model trở lại y hệt.

## Thay đổi so với sample gốc

- **Projector xử lý event tuần tự** (`for await` thay cho `on('data', async …)`): Bản gốc có thể chạy handler của nhiều event chồng lên nhau; khi replay một loạt events, phép kiểm tra `revision = streamRevision - 1` trong projection sẽ bỏ sót event.
- **Bỏ `throwOnAppendFailure=false`** khỏi connection string: Với tùy chọn này, append sai version không ném lỗi nên API vẫn trả 200 dù event không được ghi.
- **Thêm**: Bảng giá 4 sản phẩm (gốc gán giá 100 cho mọi sản phẩm), điều khiển projector (start/stop/reset), lỗi trả về JSON (`409` cho quy tắc nghiệp vụ, `412` cho version), service `app` trong docker compose, migrations chạy tự động khi tạo Postgres.
- **Đổi cổng**: EventStoreDB `2114`, Postgres `5436` để không đụng các project khác.
