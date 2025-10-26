export {
  type Event,
  type Aggregate,
  TransformationEvent,
  CreationEvent,
  type EventInfo,
  EventInfo_schema,
  Id,
  toSchema,
};

import * as s from '@/lib/json/schema';
import { Schema } from '@/lib/json/schema';
import { POSIX } from '@/lib/time';
import { createHash, randomBytes } from 'crypto';

const ALPHANUMERIC_CHARACTERS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 56;

class Id<A> {
  // @ts-expect-error _tag's existence prevents structural comparison
  private readonly _tag: null = null;

  constructor(public value: string) {}

  static schema<A>(): Schema<Id<A>> {
    return s.string.dimap(
      (v) => new Id(v),
      (id) => id.value,
    );
  }

  static random<T>(): Id<T> {
    const toChar = (byte: number) =>
      ALPHANUMERIC_CHARACTERS.charAt(byte % ALPHANUMERIC_CHARACTERS.length);
    const str = Array.from(randomBytes(ID_LENGTH)).map(toChar).join('');
    return new Id(str);
  }

  static deterministic(seed: string): string {
    if (seed.trim() == '') {
      throw new Error('Input string cannot be null or empty');
    }

    const first = createHash('sha256').update(seed).digest();
    const second = createHash('sha256').update(first).digest();
    const combined = Buffer.concat([first, second]);
    const base64Encoded = combined.toString('base64');
    const cleanId = base64Encoded.replace(/[^A-Za-z0-9]/g, '');
    return cleanId.substring(0, ID_LENGTH);
  }

  toUUID(): string {
    const hash = createHash('sha1').update(this.value).digest();
    
    // UUID v5 format: xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx
    // Set version (5) and variant bits according to RFC 4122
    const byte6 = hash[6];
    const byte8 = hash[8];
    if (byte6 !== undefined) hash[6] = (byte6 & 0x0f) | 0x50; // Version 5
    if (byte8 !== undefined) hash[8] = (byte8 & 0x3f) | 0x80; // Variant 10
    
    return [
      hash.subarray(0, 4).toString('hex'),
      hash.subarray(4, 6).toString('hex'),
      hash.subarray(6, 8).toString('hex'),
      hash.subarray(8, 10).toString('hex'),
      hash.subarray(10, 16).toString('hex'),
    ].join('-');
  }

  compare(other: Id<A>) {
    return this.value > other.value ? 1 : this.value === other.value ? 0 : -1;
  }
}

interface Aggregate<T> {
  readonly aggregateId: Id<Aggregate<T>>;
  aggregateVersion: number;
}

abstract class Event<T extends Aggregate<T>> {
  abstract values: {
    type: string;
    aggregateId: Id<T>;
  };
}

abstract class CreationEvent<T extends Aggregate<T>> extends Event<T> {
  abstract createAggregate(): T;
}

abstract class TransformationEvent<T extends Aggregate<T>> extends Event<T> {
  abstract transformAggregate(aggregate: T): T;
}

type EventInfo = s.Infer<typeof EventInfo_schema>;

const EventInfo_schema = s.object({
  event_id: Id.schema<Event<Aggregate<any>>>(),
  aggregate_id: Id.schema<Aggregate<any>>(),
  aggregate_version: s.number,
  correlation_id: Id.schema<Event<Aggregate<any>>>(),
  causation_id: Id.schema<Event<Aggregate<any>>>(),
  recorded_on: POSIX.schema,
});

function toSchema<
  T extends string,
  W extends { type: T },
  E extends { values: W },
>(ctr: (new (values: W) => E) & { type: T }, schemaArgs: Schema<W>): Schema<E> {
  return schemaArgs.dimap(
    (v) => new ctr(v),
    (v) => v.values,
  );
}
