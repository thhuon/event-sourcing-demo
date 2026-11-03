//////////////////////////////////////
/// Demo-only endpoints for the UI in /public.
/// They peek into both stores so the page can show the write side
/// (EventStoreDB) next to the read side (PostgreSQL). Not part of the
/// application's command or query API.
//////////////////////////////////////

import { getPostgres } from '#core/postgres';
import { sql } from '@databases/pg';
import {
  BACKWARDS,
  END,
  WrongExpectedVersionError,
} from '@eventstore/db-client';
import { NextFunction, Request, Response, Router } from 'express';
import { getCheckpoints } from '../core/subscriptions';
import { getEventStore } from '../core/streams';
import { products } from '../shoppingCarts/productItem';
import {
  isProjectorRunning,
  resetReadModel,
  startProjector,
  stopProjector,
  SUBSCRIPTION_ID,
} from '../subscriptions';

export const demoRouter = Router();

type CartRow = { id: number; [column: string]: unknown };

const readRecentEvents = async () => {
  const events = [];
  const read = getEventStore().readAll({
    direction: BACKWARDS,
    fromPosition: END,
    maxCount: 1000,
  });

  for await (const { event, commitPosition } of read) {
    if (!event || !event.streamId.startsWith('shopping_cart-')) continue;
    events.push({
      position: Number(commitPosition ?? 0),
      streamId: event.streamId,
      revision: Number(event.revision),
      type: event.type,
      data: event.data,
      created: event.created,
    });
    if (events.length === 100) break;
  }
  return events;
};

const readReadModel = async () => {
  const db = getPostgres();
  const carts: CartRow[] = await db.query(
    sql`SELECT * FROM cart ORDER BY id DESC LIMIT 20;`,
  );
  const ids = carts.map((c) => c.id);
  const items: CartRow[] = ids.length
    ? await db.query(
        sql`SELECT * FROM cart_item WHERE "cartId" = ANY(${ids}) ORDER BY id;`,
      )
    : [];

  return carts.map((cart) => ({
    ...cart,
    items: items.filter((item) => item.cartId === cart.id),
  }));
};

demoRouter.get(
  '/demo/state',
  async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const [events, carts, checkpoint] = await Promise.all([
        readRecentEvents(),
        readReadModel(),
        getCheckpoints().findOne({ id: SUBSCRIPTION_ID }),
      ]);
      const checkpointPosition = checkpoint ? Number(checkpoint.position) : 0;

      response.send({
        projector: isProjectorRunning() ? 'running' : 'stopped',
        checkpoint: checkpointPosition,
        lag: events.filter((e) => e.position > checkpointPosition).length,
        products,
        events,
        carts,
      });
    } catch (error) {
      next(error);
    }
  },
);

demoRouter.post('/demo/projector/start', (_request, response) => {
  void startProjector();
  response.sendStatus(202);
});

demoRouter.post(
  '/demo/projector/stop',
  async (_request: Request, response: Response, next: NextFunction) => {
    try {
      await stopProjector();
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  },
);

demoRouter.post(
  '/demo/read-model/reset',
  async (_request: Request, response: Response, next: NextFunction) => {
    try {
      await resetReadModel();
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  },
);

//////////////////////////////////////
/// Errors as JSON, so the UI can show why a command was rejected
//////////////////////////////////////

const rejections: Record<string, string> = {
  CART_IS_NOT_OPENED: 'Giỏ đã xác nhận, không nhận thêm thay đổi',
  NO_PRODUCTS_ITEMS: 'Giỏ rỗng, không thể xác nhận',
  PRODUCT_ITEM_NOT_FOUND: 'Không có đủ sản phẩm này trong giỏ',
  USER_DOES_NOT_EXISTS: 'User không tồn tại',
  OPENED_EXISTING_CART: 'Giỏ này đã được mở',
};

export const errorHandler = (
  error: unknown,
  _request: Request,
  response: Response,
  // Express recognises error handlers by their 4 parameters
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) => {
  if (error instanceof WrongExpectedVersionError) {
    response.status(412).send({
      error: 'WRONG_EXPECTED_VERSION',
      message:
        'Version không khớp: stream đã có event mới hơn version client gửi lên',
    });
    return;
  }

  const code =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';

  if (code in rejections) {
    response.status(409).send({ error: code, message: rejections[code] });
    return;
  }

  response.status(/^NOT_|HEADER|ETAG/.test(code) ? 400 : 500);
  response.send({ error: code, message: code });
};
