const data = {
    database: {
        host: process.env.MYSQL_HOST ?? "127.0.0.1",
        port: parseInt(process.env.MYSQL_PORT ?? "3306", 10),
        user: process.env.MYSQL_USER ?? "root",
        password: process.env.MYSQL_PASSWORD ?? "",
        database: process.env.MYSQL_DATABASE ?? "jarvis",
    },
};

export default data;