export {
  type DocumentStatus,
  type DocumentData,
  Document,
  schema_DocumentStatus,
  schema_DocumentData,
};

import * as s from '@/lib/json/schema';

import { Aggregate, Id } from '@/lib/eventSourcing/event';
import { Schema } from '@/lib/json/schema';

type DocumentStatus = 'Pending' | 'Embedded' | 'Failed';

const schema_DocumentStatus = s.oneOf(
  (str) => {
    switch (str) {
      case 'Pending':
        return s.stringLiteral('Pending') as Schema<DocumentStatus>;
      case 'Embedded':
        return s.stringLiteral('Embedded') as Schema<DocumentStatus>;
      case 'Failed':
        return s.stringLiteral('Failed') as Schema<DocumentStatus>;
      default:
        return str satisfies never;
    }
  },
  [
    s.stringLiteral('Pending') as Schema<DocumentStatus>,
    s.stringLiteral('Embedded') as Schema<DocumentStatus>,
    s.stringLiteral('Failed') as Schema<DocumentStatus>,
  ],
);

const schema_DocumentData = s.object({
  id: Id.schema<Document>(),
  content: s.string,
  status: schema_DocumentStatus,
  embedding: s.nullable(s.array(s.number)),
  metadata: s.nullable(s.string),
  error: s.nullable(s.string),
});

type DocumentData = s.Infer<typeof schema_DocumentData>;

class Document implements Aggregate<Document> {
  constructor(
    readonly aggregateId: Id<Document>,
    readonly aggregateVersion: number,
    public content: string,
    public status: DocumentStatus,
    public embedding?: number[],
    public metadata?: string,
    public error?: string,
  ) {}
}

