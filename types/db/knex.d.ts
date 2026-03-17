// all types into a single namespace 'DB'.
import type * as DB from './tables'

// for the SchemaBuilder.
import type { Tables } from 'knex/types/tables'

// === PART 1: QUERY BUILDER ==============================================
declare module 'knex/types/tables' {
  interface Tables {
    // === TABLES ===
    users: DB.User
    agencies: DB.Agency
    clients: DB.Client
    clients_info: DB.ClientsInfo
    teams: DB.Team
    sales: DB.Sale
    cmsn_rules: DB.CmsnRule
    deleted_sales: DB.DeletedSale
    promo: DB.Promo
    client_lists: DB.ClientList
    contracts: DB.Contract
    contract_prdcts: DB.ContractPrdct
    task_tmplts: DB.TaskTmplt
    tasks: DB.Task
    sale_users: DB.SaleUsers
    default_settings: DB.DefaultSettings
    bituchim: DB.Bituchim
    user_perms: DB.UserPerm
    user_teams: DB.UserTeam

    // === VIEWS ===
    // Views are treated as read-only tables and also benefit from strong typing.
    _flat_sales: DB.FlatSalesView
    _teams: DB.TeamsView
    _sales: DB.SalesView
  }
}

// === PART 2: SCHEMA BUILDER =============================================
declare module 'knex' {
  namespace Knex {
    interface SchemaBuilder {
      hasTable(tableName: keyof Tables): Promise<boolean>

      dropTable(tableName: keyof Tables): Knex.SchemaBuilder

      dropTableIfExists(tableName: keyof Tables): Knex.SchemaBuilder

      renameTable(from: keyof Tables, to: string): Knex.SchemaBuilder

      alterTable(from: keyof Tables, to: string): Knex.SchemaBuilder

      // The `table` method is used for altering existing tables.
      table<TTableName extends keyof Tables>(
        tableName: TTableName,
        callback: (tableBuilder: Knex.TableBuilder) => any,
      ): Knex.SchemaBuilder
    }
  }
}
