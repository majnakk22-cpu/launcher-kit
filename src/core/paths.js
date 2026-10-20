'use strict';
// Раскладка папок данных лаунчера. Общие файлы (версии, библиотеки, ассеты, Java)
// хранятся один раз и переиспользуются всеми сборками (instances).
const path = require('path');

class LauncherPaths {
  constructor(root) {
    this.root = path.resolve(root);
    this.versions = path.join(this.root, 'versions');
    this.libraries = path.join(this.root, 'libraries');
    this.assets = path.join(this.root, 'assets');
    this.runtime = path.join(this.root, 'runtime');
    this.cache = path.join(this.root, 'cache');
    this.instances = path.join(this.root, 'instances');
    this.natives = path.join(this.root, 'natives');
  }
  versionDir(id) { return path.join(this.versions, id); }
  versionJson(id) { return path.join(this.versions, id, `${id}.json`); }
  versionJar(id) { return path.join(this.versions, id, `${id}.jar`); }
  library(rel) { return path.join(this.libraries, ...rel.split('/')); }
  assetIndex(id) { return path.join(this.assets, 'indexes', `${id}.json`); }
  assetObject(hash) { return path.join(this.assets, 'objects', hash.slice(0, 2), hash); }
  logConfig(id) { return path.join(this.assets, 'log_configs', id); }
  instanceDir(id) { return path.join(this.instances, id); }
  instanceFile(id) { return path.join(this.instances, id, 'instance.json'); }
  /** Игровая папка сборки (аналог .minecraft): моды, конфиги, миры. */
  gameDir(id) { return path.join(this.instances, id, '.minecraft'); }
}

module.exports = { LauncherPaths };
