import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const records=sqliteTable('records',{id:text('id').primaryKey(),kind:text('kind').notNull(),at:integer('at').notNull(),body:text('body').notNull()},t=>[index('records_kind_at').on(t.kind,t.at)]);
export const state=sqliteTable('state',{id:text('id').primaryKey(),body:text('body').notNull()});
export const locks=sqliteTable('locks',{id:text('id').primaryKey(),until:integer('until').notNull()});
