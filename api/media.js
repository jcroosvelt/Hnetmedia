"use strict";
/** GET /media/<id> (réécrit vers /api/media?id=<id>) — sert une image téléversée depuis Neon. */
const { handler, getQuery } = require("../server/http");
const media = require("../server/media");

module.exports = handler(["GET", "HEAD"], async (req, res) => media.serve(req, res, getQuery(req).id));
