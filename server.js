"use strict";

const { createServer } = require("./Avalon/server");

const PORT = Number(process.env.PORT || 4173);

createServer().listen(PORT, () => {
  console.log(`Avalon online host running at http://localhost:${PORT}`);
});
