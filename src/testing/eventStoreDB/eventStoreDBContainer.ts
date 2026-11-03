import { KurrentDBClient } from '@kurrent/kurrentdb-client';
import {
  AbstractStartedContainer,
  GenericContainer,
  StartedTestContainer,
} from 'testcontainers';
import { Environment } from 'testcontainers/build/types';

const EVENTSTOREDB_PORT = 2113;
const EVENTSTOREDB_TCP_PORTS = [EVENTSTOREDB_PORT];
const EVENTSTOREDB_IMAGE_NAME = 'docker.kurrent.io/kurrent-latest/kurrentdb';
const EVENTSTOREDB_IMAGE_TAG = '26.1';

export class EventStoreDBContainer extends GenericContainer {
  private readonly tcpPorts = EVENTSTOREDB_TCP_PORTS;

  constructor(
    image = `${EVENTSTOREDB_IMAGE_NAME}:${EVENTSTOREDB_IMAGE_TAG}`,
    runProjections = true,
    isInsecure = true,
    emptyDatabase = true,
    withoutReuse = false,
  ) {
    super(image);

    const environment: Environment = {
      ...(runProjections
        ? {
            KURRENTDB_RUN_PROJECTIONS: 'ALL',
          }
        : {}),
      ...(isInsecure
        ? {
            KURRENTDB_INSECURE: 'true',
          }
        : {}),
      ...(!emptyDatabase
        ? {
            KURRENTDB_MEM_DB: 'false',
            KURRENTDB_DB: '/data/integration-tests',
          }
        : {}),
      KURRENTDB_CLUSTER_SIZE: '1',
      KURRENTDB_START_STANDARD_PROJECTIONS: 'true',
      KURRENTDB_NODE_PORT: `${EVENTSTOREDB_PORT}`,
      KURRENTDB_ENABLE_ATOM_PUB_OVER_HTTP: 'true',
    };

    this.withEnvironment(environment).withExposedPorts(...this.tcpPorts);

    if (!withoutReuse) this.withReuse();
  }

  async start(): Promise<StartedEventStoreDBContainer> {
    return new StartedEventStoreDBContainer(await super.start());
  }
}

export class StartedEventStoreDBContainer extends AbstractStartedContainer {
  constructor(container: StartedTestContainer) {
    super(container);
  }

  getConnectionString(): string {
    return `kurrentdb://${this.getHost()}:${this.getMappedPort(2113)}?tls=false`;
  }

  getClient(): KurrentDBClient {
    return KurrentDBClient.connectionString(this.getConnectionString());
  }
}
