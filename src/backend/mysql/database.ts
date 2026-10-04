import data from "../data";
import Log from "../Log";
import { createPool, PoolConfig } from "mysql";

let dbAvailable = true;
let dbLoggedDown = false;

const pool = createPool({
    ...data.database,
    connectionLimit: 25,
    waitForConnections: true,
    queueLimit: 5000,
    connectTimeout: 10000,
    acquireTimeout: 10000,
    timeout: 60000
} as PoolConfig);

const rawQuery = require("util").promisify(pool.query).bind(pool);

const db = {
    query: async (sql: string, values?: any[]): Promise<any> => {
        try {
            const result = await rawQuery(sql, values);
            dbAvailable = true;
            dbLoggedDown = false;
            return result;
        } catch (err: any) {
            if (err?.code === "ER_ACCESS_DENIED_NO_PASSWORD_ERROR" || err?.code === "ECONNREFUSED") {
                dbAvailable = false;
                if (!dbLoggedDown) {
                    Log.warn("MySQL unavailable, tracking/batch disabled", { component: "Database", error: err.message });
                    dbLoggedDown = true;
                }
            }
            if (err?.message === "Queue limit reached.") return [];
            throw err;
        }
    },
    isAvailable: () => dbAvailable,
    end: () => {
        dbAvailable = false;
        return new Promise<void>((resolve, reject) => pool.end((err) => err ? reject(err) : resolve()));
    },
    on: pool.on.bind(pool),
    getConnection: pool.getConnection.bind(pool)
};

pool.on('error', (err) => {
    dbAvailable = false;
    if (!dbLoggedDown) {
        Log.warn("MySQL pool error, tracking/batch disabled", { component: "Database", error: err.message });
        dbLoggedDown = true;
    }
});

const promisify = (fn: any) => (...args: any[]) =>
    new Promise((resolve, reject) => fn(...args, (err: any, res: any) => (err ? reject(err) : resolve(res))));

export const withTransaction = async <T = void>(
    fn: (conn: { query: (sql: string, params?: any[]) => Promise<any> }) => Promise<T>
): Promise<T> => {
    const conn: any = await new Promise((resolve, reject) =>
        pool.getConnection((err: any, c: any) => (err ? reject(err) : resolve(c)))
    );
    const query = promisify(conn.query.bind(conn));
    try {
        await promisify(conn.beginTransaction.bind(conn))();
        const result = await fn({ query });
        await promisify(conn.commit.bind(conn))();
        return result;
    } catch (error) {
        try {
            await promisify(conn.rollback.bind(conn))();
        } catch { }
        throw error;
    } finally {
        conn.release();
    }
};

export default db;
