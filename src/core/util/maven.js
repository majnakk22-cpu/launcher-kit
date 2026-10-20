'use strict';
// Maven-координаты: "group:artifact:version[:classifier][@ext]" -> путь в libraries/.

function parseMaven(name) {
  let ext = 'jar';
  let s = name;
  const at = s.indexOf('@');
  if (at !== -1) { ext = s.slice(at + 1); s = s.slice(0, at); }
  const [group, artifact, version, classifier] = s.split(':');
  if (!group || !artifact || !version) throw new Error(`Некорректная maven-координата: ${name}`);
  return { group, artifact, version, classifier: classifier || null, ext };
}

/** Относительный путь с прямыми слэшами. */
function mavenPath(name) {
  const { group, artifact, version, classifier, ext } = parseMaven(name);
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

/** Ключ для дедупликации библиотек (без версии). */
function mavenKey(name) {
  const { group, artifact, classifier } = parseMaven(name);
  return `${group}:${artifact}${classifier ? `:${classifier}` : ''}`;
}

module.exports = { parseMaven, mavenPath, mavenKey };
