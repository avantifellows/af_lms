export interface RequiredSchemaColumn {
  table: string;
  column: string;
}

export const CENTRE_COMMON_SCHEMA_COLUMNS: RequiredSchemaColumn[] = [
  { table: "centres", column: "id" },
  { table: "centres", column: "name" },
  { table: "centres", column: "school_id" },
  { table: "centres", column: "type_code" },
  { table: "centres", column: "category_code" },
  { table: "centres", column: "sub_category_code" },
  { table: "centres", column: "is_physical" },
  { table: "centres", column: "is_active" },
  { table: "centres", column: "inserted_at" },
  { table: "centres", column: "updated_at" },
];

interface SchemaQuery {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export async function findMissingSchemaColumns(
  db: SchemaQuery,
  requiredColumns: RequiredSchemaColumn[]
): Promise<string[]> {
  const values = requiredColumns
    .map((_column, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
    .join(", ");
  const params = requiredColumns.flatMap(({ table, column }) => [table, column]);
  const rows = await db.query<{ table_name: string; column_name: string }>(
    `WITH required(table_name, column_name) AS (VALUES ${values})
     SELECT required.table_name, required.column_name
     FROM required
     LEFT JOIN information_schema.columns cols
       ON cols.table_schema = 'public'
      AND cols.table_name = required.table_name
      AND cols.column_name = required.column_name
     WHERE cols.column_name IS NULL
     ORDER BY required.table_name, required.column_name`,
    params
  );
  return rows.map((row) => `${row.table_name}.${row.column_name}`);
}
