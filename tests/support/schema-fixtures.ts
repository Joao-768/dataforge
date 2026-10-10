import type { SchemaColumn, SchemaTable } from '@/shared/schema/model'

export function column(
    id: string,
    name: string,
    type: string,
    patch: Partial<SchemaColumn> = {},
): SchemaColumn {
    return {
        id,
        name,
        type,
        nullable: true,
        default: null,
        identity: null,
        generated: null,
        comment: null,
        ...patch,
    }
}

export function table(
    id: string,
    name: string,
    columns: SchemaColumn[],
    patch: Partial<SchemaTable> = {},
): SchemaTable {
    return {
        id,
        schema: 'public',
        name,
        comment: null,
        columns,
        primaryKey: null,
        uniques: [],
        foreignKeys: [],
        checks: [],
        indexes: [],
        rowEstimate: 0,
        ...patch,
    }
}

/** users(id pk) and orders(id pk, user_id -> users.id), as introspection would return them. */
export function baseSchema(): SchemaTable[] {
    const users = table(
        't1',
        'users',
        [
            column('c1.1', 'id', 'bigint', { nullable: false, identity: 'always' }),
            column('c1.2', 'email', 'text', { nullable: false }),
        ],
        {
            primaryKey: { id: 'k1', name: 'users_pkey', columns: ['c1.1'] },
            uniques: [{ id: 'k2', name: 'users_email_key', columns: ['c1.2'] }],
            rowEstimate: 100,
        },
    )
    const orders = table(
        't2',
        'orders',
        [
            column('c2.1', 'id', 'bigint', { nullable: false }),
            column('c2.2', 'user_id', 'bigint', { nullable: false }),
            column('c2.3', 'note', 'varchar(50)'),
        ],
        {
            primaryKey: { id: 'k3', name: 'orders_pkey', columns: ['c2.1'] },
            foreignKeys: [
                {
                    id: 'k4',
                    name: 'orders_user_id_fkey',
                    columns: ['c2.2'],
                    refTableId: 't1',
                    refColumns: ['c1.1'],
                    onDelete: 'NO ACTION',
                    onUpdate: 'NO ACTION',
                },
            ],
            rowEstimate: 500,
        },
    )
    return [users, orders]
}
