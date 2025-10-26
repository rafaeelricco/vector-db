export {
  type EventStore,
  type AggregateAndEventIdsInLastEvent,
  Schemas,
  type Constructor,
  type EventData,
  schema_EventData,
  makeSchema,
  makeDecoder,
  CSchema,
  TSchema,
  type Serialized,
};

import {
  CreationEvent,
  TransformationEvent,
  EventInfo,
  Event,
  Aggregate,
  Id,
} from '@/lib/eventSourcing/event';
import { Json } from '@/lib/json/types';
import { Schema } from '@/lib/json/schema';
import { Encoder } from '@/lib/json/encoder';
import { Decoder } from '@/lib/json/decoder';
import * as s from '@/lib/json/schema';
import * as d from '@/lib/json/decoder';
import { POSIX } from '@/lib/time';
import { Result, Failure } from '@/lib/Result';
import { DateTime } from 'luxon';


interface AggregateAndEventIdsInLastEvent<T extends Aggregate<T>> {
  aggregate: T;
  eventIdOfLastEvent: Id<Event<T>>;
  correlationIdOfLastEvent: Id<Event<T>>;
}

interface EventStore {
  find<T extends Aggregate<T>>(
    cls: Constructor<T>,
    aggregateId: Id<T>,
  ): Promise<T>;

  try_find<T extends Aggregate<T>>(
    cls: Constructor<T>,
    aggregateId: Id<T>,
  ): Promise<T | null>;

  emit<T extends Aggregate<T>>(args: {
    aggregate: Constructor<T>;
    event: CreationEvent<T> | TransformationEvent<T>;
    event_id?: Id<Event<T>>;
    correlation_id?: Id<Event<T>>;
    causation_id?: Id<Event<T>>;
  }): Promise<{ event: Event<T>; info: EventInfo }>;

  doesEventAlreadyExist(eventId: Id<Event<any>>): Promise<boolean>;
}


type Serialized<P> = s.Infer<ReturnType<typeof schema_Serialized<P>>>;

const schema_Serialized = <Payload>(payload: Schema<Payload>) =>
  s.object({
    event_id: Id.schema<Event<Aggregate<any>>>(),
    aggregate_id: Id.schema<Aggregate<any>>(),
    aggregate_version: s.number,
    correlation_id: Id.schema<Event<Aggregate<any>>>(),
    causation_id: Id.schema<Event<Aggregate<any>>>(),
    recorded_on: schema_UTC,
    json_payload: schema_StringifiedJSON(payload),
  });

const schema_UTC: s.Schema<POSIX> = s.string.then(
  (s) => {
    // Try ISO format first (e.g., "2025-10-25T20:55:11.880Z")
    let date = DateTime.fromISO(s, { zone: 'UTC' });

    // Try SQL format (e.g., "2025-10-25 20:55:11.880809")
    if (!date.isValid) {
      date = DateTime.fromSQL(s, { zone: 'UTC' });
    }

    // Try parsing as Postgres format (e.g., "2025-10-25 21:23:50+00")
    if (!date.isValid) {
      const postgresFormat = s.replace('+00', 'Z').replace(' ', 'T');
      date = DateTime.fromISO(postgresFormat, { zone: 'UTC' });
    }

    return date.isValid
      ? d.succeed(new POSIX(date.toMillis()))
      : d.fail(`Invalid date format: ${s} (expected ISO, SQL, or Postgres format)`);
  },
  (s) => {
    const { date, time } = s.toUTCDateAndTime();
    return `${date.pretty()}T${time.pretty()}Z`;
  },
);

const schema_StringifiedJSON = <T>(inner: s.Schema<T>): s.Schema<T> =>
  new s.Schema(
    // Decoder: handle both stringified JSON and already-parsed objects
    new Decoder((input: unknown) => {
      if (typeof input === 'string') {
        // Case 1: Stringified JSON (from direct DB access)
        return inner.decoder.run(JSON.parse(input));
      } else {
        // Case 2: Already-parsed object (from Ambar HTTP push after CDC)
        return inner.decoder.run(input);
      }
    }),
    // Encoder: always stringify
    new Encoder((t: T): string => JSON.stringify(inner.encoder.run(t))),
  );


type EventData<E> = { info: EventInfo; event: E };

function toSerialized<P>({
  info,
  event,
}: {
  info: EventInfo;
  event: P;
}): Serialized<P> {
  return { ...info, json_payload: event };
}

function fromSerialized<P>(serialized: Serialized<P>): {
  info: EventInfo;
  event: P;
} {
  const { json_payload, ...info } = serialized;
  return { info, event: json_payload };
}

const schema_EventData = <E>(s: Schema<E>): Schema<EventData<E>> =>
  schema_Serialized(s).dimap(fromSerialized, toSerialized);


type Constructor<T> = new (...args: any[]) => T;

class CSchema<
  A extends Aggregate<A>,
  E extends CreationEvent<A>,
  T extends E['values']['type'],
> {
  constructor(
    public aggregate: Constructor<A>,
    public schema: Schema<E>,
    public type: T,
  ) {}
}

class TSchema<
  A extends Aggregate<A>,
  E extends TransformationEvent<A>,
  T extends E['values']['type'],
> {
  constructor(
    public aggregate: Constructor<A>,
    public schema: Schema<E>,
    public type: T,
  ) {}
}

type SomeSchema<A extends Aggregate<A>> =
  | CSchema<A, CreationEvent<A>, any>
  | TSchema<A, TransformationEvent<A>, any>;

type Decoders<T extends Aggregate<T>> = {
  creation: Decoder<EventData<CreationEvent<T>>>;
  transformation: Decoder<EventData<TransformationEvent<T>>>;
};

class Schemas {
  private cmap = new Map<Constructor<Aggregate<any>>, Decoders<any>>();
  private tmap = new Map<string, Encoder<EventData<any>>>();

  constructor(
    arr: Array<{
      type: string;
      schema: Schema<any>;
      aggregate: Constructor<Aggregate<any>>;
    }>,
  ) {
    const entries: Array<SomeSchema<Aggregate<any>>> = arr.map((entry) => {
      if (entry instanceof CSchema || entry instanceof TSchema) {
        return entry;
      }
      throw new Error(`Value should be an instance of SomeSchema`);
    });

    // Set encoders
    for (const entry of entries) {
      if (this.tmap.has(entry.type)) {
        throw new Error(`Duplicate entry for ${entry.type}`);
      }

      if (entry instanceof CSchema) {
        this.tmap.set(entry.type, schema_EventData(entry.schema).encoder);
      } else if (entry instanceof TSchema) {
        this.tmap.set(entry.type, schema_EventData(entry.schema).encoder);
      } else {
        entry satisfies never;
      }
    }

    type Events<T extends Aggregate<T>> = {
      creation: Array<{
        type: string;
        schema: Schema<CreationEvent<T>>;
      }>;
      transformation: Array<{
        type: string;
        schema: Schema<TransformationEvent<T>>;
      }>;
    };

    const emap: Map<Constructor<Aggregate<any>>, Events<any>> = new Map();

    for (const entry of entries) {
      const aggregate = entry.aggregate;
      const found: Events<any> = emap.get(aggregate) || {
        creation: [],
        transformation: [],
      };

      if (entry instanceof CSchema) {
        found.creation.push({ schema: entry.schema, type: entry.type });
      } else if (entry instanceof TSchema) {
        found.transformation.push({ schema: entry.schema, type: entry.type });
      } else {
        entry satisfies never;
      }
    }

    for (const [aggregate, events] of emap.entries()) {
      this.cmap.set(aggregate, {
        creation: schema_EventData(makeSchema(events.creation)).decoder,
        transformation: schema_EventData(makeSchema(events.transformation))
          .decoder,
      });
    }
  }

  encode<E extends Event<any>>(edata: EventData<E>): Json {
    const ty = edata.event.values.type;
    const found = this.tmap.get(ty) as undefined | Encoder<EventData<E>>;
    if (found == undefined) {
      throw new Error(`Unknown event type ${ty}`);
    }

    return found.run(edata);
  }

  // Build an aggregate from all its serialized events.
  hydrate<A extends Aggregate<A>>(
    cls: Constructor<A>,
    serialized: Json[],
  ): Result<string, { aggregate: A; lastEvent: EventInfo }> {
    const schemas = this.cmap.get(cls) as undefined | Decoders<A>;
    if (schemas == undefined) {
      throw new Error(`Unknown aggregate ${cls.name}`);
    }

    if (serialized.length === 0) {
      return Failure('No events');
    }

    return d
      .decode(serialized[0], schemas.creation)
      .then(({ event: first, info }) =>
        d
          .decode(serialized.slice(1), d.array(schemas.transformation))
          .map((es) => {
            let aggregate = first.createAggregate();
            let lastEvent = info;

            for (const t of es) {
              aggregate = t.event.transformAggregate(aggregate);
              lastEvent = t.info;
            }

            return { aggregate, lastEvent };
          }),
      );
  }
}


type EventConstructor = { type: string; schema: Schema<any> };

function makeSchema<T extends [...EventConstructor[]]>(
  ts: T,
): Schema<s.Infer<T[number]['schema']>> {
  type Ty = s.Infer<T[number]['schema']>;

  const decoder: Decoder<Ty> = d
    .object({ type: d.string })
    .then(({ type: ty }) => {
      const c: undefined | EventConstructor = ts.find((t) => t.type === ty);

      if (c === undefined) return d.fail(`Unknown event type: ${ty}`);

      return c.schema.decoder as Decoder<Ty>;
    });

  const encoder: Encoder<Ty> = new Encoder((v: Ty) => {
    const ty = ts.find((t) => t.type === v.type);
    if (ty === undefined) {
      throw new Error(`Unable to encode unknown event type: ${v.type}`);
    }

    return ty.schema.encoder.run(v);
  });

  return new Schema(decoder, encoder);
}

function makeDecoder<T extends [...EventConstructor[]]>(
  ts: T,
): Decoder<s.Infer<T[number]['schema']>> {
  return makeSchema(ts).decoder;
}
