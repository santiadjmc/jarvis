import Log from "../Log";
import db from "./database";
import type { ParsedTableSchema } from "../types/mysql";

const splitTopLevel = (value: string): string[] => {
    const result: string[] = [];
    let current = "";
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        const prev = i > 0 ? value[i - 1] : "";
        if (char === "'" && !inDouble && prev !== "\\") inSingle = !inSingle;
        if (char === "\"" && !inSingle && prev !== "\\") inDouble = !inDouble;
        if (!inSingle && !inDouble) {
            if (char === "(") depth += 1;
            if (char === ")") depth = Math.max(0, depth - 1);
            if (char === "," && depth === 0) {
                if (current.trim()) result.push(current.trim());
                current = "";
                continue;
            }
        }
        current += char;
    }
    if (current.trim()) result.push(current.trim());
    return result;
};

const normalizeSql = (value: string): string => {
    return value
        .replace(/`/g, "")
        .replace(/\bboolean\b/gi, "tinyint(1)")
        .replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/gi, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
};

const parseConstraintColumns = (fragment: string): string[] => {
    const match = fragment.match(/\((.+)\)/);
    if (!match) return [];
    return splitTopLevel(match[1])
        .map(part => part.trim().replace(/`/g, "").replace(/\(.+\)/, ""))
        .filter(Boolean);
};

const parseCreateTableStatement = (sql: string): ParsedTableSchema => {
    const tableMatch = sql.match(/CREATE TABLE(?: IF NOT EXISTS)?\s+([^\s(]+)/i);
    if (!tableMatch) throw new Error(`Unable to parse table name from schema: ${sql.slice(0, 80)}`);
    const tableName = tableMatch[1].replace(/`/g, "");
    const openIndex = sql.indexOf("(");
    const closeIndex = sql.lastIndexOf(")");
    const body = openIndex >= 0 && closeIndex > openIndex ? sql.slice(openIndex + 1, closeIndex) : "";
    const parts = splitTopLevel(body);
    const columns = new Map<string, string>();
    const primaryKeyColumns: string[] = [];
    const uniqueColumns = new Set<string>();
    const extraConstraints: string[] = [];

    for (const rawPart of parts) {
        const part = rawPart.trim();
        if (!part) continue;
        if (/^PRIMARY KEY\b/i.test(part)) {
            primaryKeyColumns.push(...parseConstraintColumns(part));
            continue;
        }
        if (/^(CONSTRAINT|FOREIGN KEY|UNIQUE KEY|UNIQUE INDEX|KEY|INDEX)\b/i.test(part)) {
            extraConstraints.push(part);
            continue;
        }
        const columnMatch = part.match(/^`?([a-zA-Z0-9_]+)`?\s+([\s\S]+)$/);
        if (!columnMatch) continue;
        const columnName = columnMatch[1];
        let definition = `${columnName} ${columnMatch[2].trim()}`;
        if (/\bPRIMARY KEY\b/i.test(definition)) {
            primaryKeyColumns.push(columnName);
            definition = definition.replace(/\bPRIMARY KEY\b/gi, " ");
        }
        if (/\bUNIQUE\b/i.test(definition)) {
            uniqueColumns.add(columnName);
            definition = definition.replace(/\bUNIQUE\b/gi, " ");
        }
        definition = definition.replace(/\s+/g, " ").trim();
        columns.set(columnName, definition);
    }

    return {
        tableName,
        columns,
        primaryKeyColumns: Array.from(new Set(primaryKeyColumns)),
        uniqueColumns: Array.from(uniqueColumns),
        extraConstraints
    };
};

const getShowCreateTable = async (tableName: string): Promise<string> => {
    const rows = await db.query(`SHOW CREATE TABLE \`${tableName}\``) as unknown as any[];
    const row = rows?.[0] ?? {};
    return String(row["Create Table"] ?? row["Create View"] ?? "");
};

const ensurePrimaryKey = async (tableName: string, expectedColumns: string[]): Promise<void> => {
    if (expectedColumns.length === 0) return;
    const rows = await db.query(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = 'PRIMARY'`) as unknown as any[];
    const actualColumns = Array.isArray(rows)
        ? [...rows]
            .sort((a: any, b: any) => Number(a.Seq_in_index ?? 0) - Number(b.Seq_in_index ?? 0))
            .map((row: any) => String(row.Column_name ?? ""))
            .filter(Boolean)
        : [];
    if (normalizeSql(actualColumns.join(",")) === normalizeSql(expectedColumns.join(","))) return;
    if (actualColumns.length > 0) {
        try {
            await db.query(`ALTER TABLE \`${tableName}\` DROP PRIMARY KEY`);
        } catch {}
    }
    await db.query(`ALTER TABLE \`${tableName}\` ADD PRIMARY KEY (${expectedColumns.map(column => `\`${column}\``).join(", ")})`);
};

const ensureUniqueColumns = async (tableName: string, uniqueColumns: string[]): Promise<void> => {
    if (uniqueColumns.length === 0) return;
    const rows = await db.query(`SHOW INDEX FROM \`${tableName}\``) as unknown as any[];
    for (const column of uniqueColumns) {
        const exists = Array.isArray(rows) && rows.some((row: any) => Number(row.Non_unique) === 0 && String(row.Column_name ?? "") === column);
        if (exists) continue;
        await db.query(`ALTER TABLE \`${tableName}\` ADD UNIQUE (\`${column}\`)`);
    }
};

const ensureExtraConstraints = async (tableName: string, constraints: string[]): Promise<void> => {
    if (constraints.length === 0) return;
    const existingIndexes = new Set<string>();
    try {
        const rows = await db.query(`SHOW INDEX FROM \`${tableName}\``) as unknown as any[];
        if (Array.isArray(rows)) {
            for (const row of rows) {
                if (row.Key_name) existingIndexes.add(String(row.Key_name));
            }
        }
    } catch {}
    let showCreate = "";
    for (const constraint of constraints) {
        if (/^(?:UNIQUE\s+)?(?:KEY|INDEX)\s+/i.test(constraint)) {
            const nameMatch = constraint.match(/^(?:UNIQUE\s+)?(?:KEY|INDEX)\s+(\S+)/i);
            const indexName = nameMatch ? nameMatch[1].replace(/`/g, "") : null;
            if (indexName && existingIndexes.has(indexName)) continue;
        } else {
            if (!showCreate) {
                try { showCreate = await getShowCreateTable(tableName); } catch {}
            }
            if (showCreate && normalizeSql(showCreate).includes(normalizeSql(constraint))) continue;
        }
        try {
            await db.query(`ALTER TABLE \`${tableName}\` ADD ${constraint}`);
        } catch (error: any) {
            Log.warn("Schema constraint ensure failed", { tableName, constraint, error: error?.message ?? String(error) });
        }
    }
};

const ensureTableFromSchema = async (createSql: string): Promise<void> => {
    const expected = parseCreateTableStatement(createSql);
    try {
        await db.query(createSql);
    } catch (error: any) {
        Log.warn("Schema table create failed", { tableName: expected.tableName, error: error?.message ?? String(error) });
        return;
    }
    let actual: ParsedTableSchema;
    try {
        actual = parseCreateTableStatement(await getShowCreateTable(expected.tableName));
    } catch (error: any) {
        Log.warn("Schema show create table failed", { tableName: expected.tableName, error: error?.message ?? String(error) });
        return;
    }

    for (const [columnName, definition] of expected.columns.entries()) {
        const actualDefinition = actual.columns.get(columnName);
        if (!actualDefinition) {
            await db.query(`ALTER TABLE \`${expected.tableName}\` ADD COLUMN ${definition}`);
            actual = parseCreateTableStatement(await getShowCreateTable(expected.tableName));
            continue;
        }
        if (normalizeSql(actualDefinition) === normalizeSql(definition)) continue;
        try {
            await db.query(`ALTER TABLE \`${expected.tableName}\` MODIFY COLUMN ${definition}`);
            actual = parseCreateTableStatement(await getShowCreateTable(expected.tableName));
        } catch (error: any) {
            Log.warn("Schema column reconcile failed", { tableName: expected.tableName, columnName, definition, error: error?.message ?? String(error) });
        }
    }

    try {
        await ensurePrimaryKey(expected.tableName, expected.primaryKeyColumns);
    } catch (error: any) {
        Log.warn("Schema primary key ensure failed", { tableName: expected.tableName, error: error?.message ?? String(error) });
    }

    try {
        await ensureUniqueColumns(expected.tableName, expected.uniqueColumns);
    } catch (error: any) {
        Log.warn("Schema unique ensure failed", { tableName: expected.tableName, error: error?.message ?? String(error) });
    }

    await ensureExtraConstraints(expected.tableName, expected.extraConstraints);
};

const tableDefinitions: string[] = [];

export default async function queries(): Promise<void> {
    for (const createSql of tableDefinitions) {
        await ensureTableFromSchema(createSql);
    }
    Log.info("Database tables ensured", { component: "Database", tables: tableDefinitions.length });
}
