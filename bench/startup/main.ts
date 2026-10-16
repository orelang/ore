// Startup: hello world, printed n times. With the default of one line, the
// time is that of starting the process and the runtime and exiting.

const n = process.argv.length > 2 ? Number.parseInt(process.argv[2]) : 1

for (let i = 0; i < n; i++) console.log("hello, world")
