import { startAPI } from '#core/api';
import { disconnectFromPostgres } from '#core/postgres';
import express, { Router } from 'express';
import path from 'path';
import { disconnectFromEventStore } from './core/streams';
import { demoRouter, errorHandler } from './demo/routes';
import { router } from './shoppingCarts/routes';
import { startProjector } from './subscriptions';

//////////////////////////////////////////////////////////
/// Make sure that we dispose Postgres connection pool
//////////////////////////////////////////////////////////

process.once('SIGTERM', disconnectFromPostgres);
process.once('SIGTERM', disconnectFromEventStore);

//////////////////////////////////////////////////////////
/// API (+ demo UI served from /public)
//////////////////////////////////////////////////////////

const app = Router();
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(demoRouter);
app.use(router);
app.use(errorHandler);

startAPI(app);

//////////////////////////////////////////////////////////
/// Run
//////////////////////////////////////////////////////////

void startProjector();
