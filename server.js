
var express = require("express");
var compression = require("compression");
var favicon = require("serve-favicon");
var bodyParser = require("body-parser");
var mongo = require("mongodb");
var moment = require("moment");
var uuid = require("node-uuid");
var fs = require("fs");
var config = require("./config.json");

var app = express();
var server = new mongo.Server(config.db.host, config.db.port, { auto_reconnect: true });
var db = new mongo.Db(config.db.name, server, { safe: true });
var layout = fs.readFileSync("./template.html", "utf8");

function renderTemplate(res, template, data) {
  fs.readFile(template, "utf8", function(error, content) {
    if (data) {
      for (var name in data) {
        content = content.replace("{" + name + "}", data[name]);
      }
    }

    res.send(layout.replace(/\{content\}/, content));
  });
}

db.open(function(error, mongoDb) {
  if (error) {
    console.error("Failed to connect to mongoDB, reason: " + error.toString());
    return;
  }

  app.use(bodyParser());
  app.use(compression({ threshold: 512 }));

  app.get(/^\/(index\.html)?$/, function(req, res) {
    renderTemplate(res, "index.html");
  });
  
  app.get("/policy", function(req, res) {
    renderTemplate(res, "policy.html");
  });

  app.get("/style.css", function(req, res) {
    res.setHeader("Cache-Control", "public, max-age=345600"); // 4 days
    res.setHeader("Expires", new Date(Date.now() + 345600000).toUTCString());
    res.sendfile("./style.css");
  });
  
  app.use(favicon("./favicon.ico", { maxAge: 2592000000 }));
  
  app.post("/publish", function(req, res) {
    db.collection("published", function(error, collection) {
      if (error) {
        console.error(error.toString());
        renderTemplate(res, "error.html", { error: "Failed to publish, please try again later..." });
        return;
      }
      
      var doc = {
        _id: uuid.v4(),
        code: req.body.code.substr(0, 1024),
        highlight: req.body.highlight,
        lifetime: req.body.lifetime,
        created: new Date()
      };
      
      if (req.body.lifetime === "month") {
        doc.expires = moment().add("months", 1).toDate();
      } else if (req.body.lifetime === "week") {
        doc.expires = moment().add("weeks", 1).toDate();
      } else /* if (req.body.lifetime === "day") */ {
        doc.expires = moment().add("days", 1).toDate();
      }
      
      collection.insert(doc, function(error, docs) {
        if (error) {
          console.error(error.toString());
          renderTemplate(res, "error.html", { error: "Failed to publish, please try again later..." });
          return;
        }
        
        console.log("New code published at " + moment().format());
        console.log(JSON.stringify(docs[0]));
        
        res.redirect("/show/" + docs[0]._id);
      });
    });
  });

  app.get("/show/:id", function(req, res) {
    db.collection("published", function(error, collection) {
      if (error) {
        console.error(error.toString());
        renderTemplate(res, "error.html", { error: "Failed to fetch, please try again later..." });
        return;
      }
      
      collection.findOne({ _id: req.params.id }, function(error, doc) {
        if (error) {
          console.error(error.toString());
          renderTemplate(res, "error.html", { error: "Failed to fetch, please try again later..." });
          return;
        }
        
        if (!doc) {
          renderTemplate(res, "error.html", { error: "Could not find the requested code, please check your address." });
          return;
        }
        
        renderTemplate(res, "show.html", { doc: JSON.stringify(doc, null, 2) });
      });
    });
  });

  app.listen(config.http.port);
  
  function expire() {
    console.log("Running cleanup at " + moment().format());
    
    db.collection("published", function(error, collection) {
      if (error) {
        console.error(error.toString());
        return;
      }
      
      collection.remove({ expires: { $lt: new Date() } }, function(error, num) {
        if (error) {
          console.error(error.toString());
          return;
        }
        
        console.log("Removed " + num + " expired documents!");
      });
    });
  }
  
  setInterval(expire, 3600000 /* 1 hour */);
  expire();
});
