import { getPostgres } from '#core/postgres';
import { sleep } from '#core/retries';
import { sql } from '@databases/pg';
import {
  getCheckpoints,
  handleEventInPostgresTransactionScope,
  RunningSubscription,
  SubscriptionToAllWithPostgresCheckpoints,
} from './core/subscriptions';
import { projectToShoppingCartItem } from './shoppingCarts/shoppingCartDetails';

export const SUBSCRIPTION_ID = 'sub_shopping_carts';

export const runSubscription = () =>
  SubscriptionToAllWithPostgresCheckpoints(SUBSCRIPTION_ID, [
    handleEventInPostgresTransactionScope([projectToShoppingCartItem]),
  ]);

//////////////////////////////////////
/// Projector control (used by the demo UI)
//////////////////////////////////////

let current: RunningSubscription | undefined;
let wanted = false;
let starting = false;

export const isProjectorRunning = () => current !== undefined;

// Keeps the projector alive: if the subscription fails (e.g. EventStoreDB is
// still starting), it restarts from the last checkpoint after a short pause.
export const startProjector = async (): Promise<void> => {
  wanted = true;
  if (starting) return;
  starting = true;
  try {
    while (wanted && !current) {
      try {
        const subscription = await runSubscription();
        current = subscription;
        subscription.processing
          .catch((error) => {
            if (wanted) console.error('Projector stopped with error: %s', error);
          })
          .finally(() => {
            if (current !== subscription) return;
            current = undefined;
            if (wanted) void sleep(2000).then(startProjector);
          });
      } catch (error) {
        console.error('Cannot start projector, retrying: %s', error);
        await sleep(2000);
      }
    }
  } finally {
    starting = false;
  }
};

export const stopProjector = async (): Promise<void> => {
  wanted = false;
  const subscription = current;
  if (!subscription) return;

  await subscription.unsubscribe();
  await subscription.processing.catch(() => undefined);
  current = undefined;
};

// Drops everything the projector built. Events in EventStoreDB stay untouched,
// so starting the projector again replays them from the beginning.
export const resetReadModel = async (): Promise<void> => {
  await stopProjector();
  await getPostgres().tx(async (db) => {
    await db.query(sql`TRUNCATE cart_item, cart RESTART IDENTITY;`);
  });
  await getCheckpoints().delete({ id: SUBSCRIPTION_ID });
};
