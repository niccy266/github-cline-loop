import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  customLevels: {
    agent: 35,
  },
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      customLevels: "agent:35,fatal:60,error:50,warn:40,info:30,debug:20,trace:10",
      customColors: "agent:magenta",
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
      ignore: "pid,hostname",
    },
  },
});


