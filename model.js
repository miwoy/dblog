const dottie = require("dottie")
const md5 = require("md5")
const _ = require("lodash")
const uuid = require("uuid")
const debug = require("debug")("dblog:")


class Dblog {
    constructor(log) {
        log = log || {}
        this.values = log.values || {}
        this.trees = log.trees || {}
        this.versions = log.versions || {}
        this.latest = log.latest || null
    }
    addValue(value) {
        let key = md5(JSON.stringify(value))
        this.values[key] = value
        return key
    }
    addTree(project) {
        let tree = {}
        _.mapKeys(project, (value, key) => {
            if (_.isArray(value)) {
                tree[key] = value.map((v) => this.addValue(v))
            } else {
                tree[key] = this.addValue(value)
            }

        })
        let key = md5(JSON.stringify(tree))
        this.trees[key] = tree
        return key
    }
    addVersion(project, attach) {
        attach = attach || {}
        let treeKey = this.addTree(project)

        if (treeKey != this.latest) {
            let datetime = new Date()
            let version = {
                "head": this.latest,
                "merge": attach.merge || null,
                "tree": treeKey,
                "date": datetime,
                "commit": attach.message || datetime,
                "author": attach.author || null,
                "email": attach.email || null
            }
            let key = md5(JSON.stringify(version))
            version.key = key
            this.latest = key
            this.versions[key] = version
        }

        return this.versions[this.latest]
    }
    getProject(key) {
        if (!this.versions[key]) throw new Error(`不存在的版本哈希 ${key}`)
        let project = {}
        let tree = this.trees[this.versions[key].tree]
        _.mapKeys(tree, (value, key) => {
            if (_.isArray(value)) {
                project[key] = value.map(v => this.values[v])
            } else {
                project[key] = this.values[value]
            }

        })
        return project
    }
}

class Document {
    constructor(store, doc) {
        doc = doc || {}
        this.store = store
        this[".log"] = new Dblog(doc[".log"])
        this.project = doc.project || {}
        this._id = doc._id
        this._rev = doc._rev
        this.remote = {
            latest: null, 
            versions : []
        }
        debug("create document instance ")
    }
    async push() {
        if (!this.store) throw new Error("未连接到数据库")
        debug(`push version ${this[".log"].latest}`)
        // return debug(`push data `, JSON.stringify(this.project).byteLength(), JSON.stringify(this[".log"]).byteLength())
        if (!this[".log"].latest) return {
            ok: false,
            msg: "没有可推送的版本"
        }
        let result = await this.store.insert(this.toJSON())
        debug(`push done `, result)
        if (result && result.ok) {
            this._rev = result.rev
            this._id = result.id
        }
        return result
    }
    async pull() {
        if (!this.store) throw new Error("未连接到数据库")

        let result = await this.store.findOne({
            selector: {
                _id: {
                    "$eq": this._id
                }
            },
            limit: 1
        })
        // result = result && result.docs && result.docs[0]
        debug("pull result ")
        if (!result || result.length == 0) return debug("pull done ", result)
        let diff = this.diff(this.project, result.project)
        this._rev = result._rev
        this.remote.latest = result[".log"].latest
        this.remote.versions = result[".log"].versions
        if (this[".log"].versions[result[".log"].latest] || result[".log"].versions[this[".log"].latest]) { // 是否是历史版本，历史版本不需要处理
            // todo
        } else {
            if (diff.length > 0) {
                if (!diff.reduce((t, d) => {
                        t = t || d.conflict
                        return t
                    }, false)) { // 检测是否可以自动合并
                    this.automerge(result)
                } else {
                    throw new Error("版本冲突", diff)
                }
            }

        }
        return debug("pull done ")
    }
    async getRemoteLatest() {
        let result = await this.store.findOne({
            selector: {
                _id: {
                    "$eq": this._id
                }
            },
            fields: ["\\.log.latest","\\.log.versions", "_rev"],
            limit: 1
        })
        this.remote.latest = result[".log"] && result[".log"].latest
        this.remote.versions = result[".log"].versions
        this._rev = result._rev
    }
    diff(proj1, proj2) {
        debug("diff ")
        let paths = _.uniq(dottie.paths(proj1).concat(dottie.paths(proj2)))
        let result = []
        paths.map(p => {
            if (dottie.get(proj1, p) !== dottie.get(proj2, p)) {
                result.push({
                    path: p,
                    1: dottie.get(proj1, p),
                    2: dottie.get(proj2, p),
                    conflict: dottie.get(proj1, p) !== undefined && dottie.get(proj2, p) !== undefined
                })
            }
        })
        debug("diff done ", result)
        return result
    }
    commit(project, attach) {
        debug("commit", attach)
        let version = this[".log"].addVersion(project, attach)
        this.project = project
        debug("commit done", version)
        return version
    }
    checkout(version) {
        return this[".log"].getProject(version)
    }
    logs() {
        return _.sortBy(_.values(this[".log"].versions), ["date"]).reverse()
    }
    automerge(result) {
        debug("automerge")
        let latest = this[".log"].latest
        this[".log"] = _.extend(this[".log"], result[".log"])
        let project = _.extend(this.project, result.project)
        if (latest) {
            this[".log"].latest = latest
            this.commit(project, {
                message: `来自于版本 ${result[".log"].latest} 的自动合并`,
                merge: result[".log"].latest
            })
        }
        debug("automerge done")
    }
    toJSON() {
        let propnames = ["_id", "_rev", "project", ".log"]
        return propnames.reduce((obj, key) => {
            obj[key] = this[key]
            return obj
        }, {})
    }
}

class Store {
    constructor(name) {
        this.name = name
    }
    async insert(data) {
        throw new Error("必须实现 data 方法")
    }
    async find(queryData) {
        throw new Error("必须实现 find 方法")
    }
    async findOne(query) {
        query = query || {}
        query.limit = 1
        let r = await this.find(query)
        return r[0] || r
    }
    async findByPk(pk) {
        let r = await this.findOne({
            selector: {
                _id: pk
            }
        })
        return r
    }
    async destroy(queryData) {
        throw new Error("必须实现 destroy 方法")
    }

}

class CouchDbStore extends Store {
    constructor(db) {
        super("CouchDb")
        this.db = db
    }
    async insert(data) {
        return await this.db.insert(data)
    }
    async find(query) {
        let r = await this.db.find(query)
        return r.docs ? r.docs : r
    }
    async destroy() {
        return await this.db.destroy(...arguments)
    }
}

class MemDbStore extends Store {
    constructor(db) {
        super("MemDb")
        this.db = db || []
    }
    async insert(data) {
        if (data._id) {
            let index = this.db.findIndex((d) => d._id == data._id)
            if (index >= 0) {
                if (this.db[index]._rev !== data._rev) {
                    throw new Error("版本冲突")
                }
                this.db[index] = data
                this.db[index]._rev++
                return {
                    ok: true,
                    id: data._id,
                    rev: this.db[index]._rev
                }
            }
        }

        data._id = data._id || uuid.v4().replace("-", "")
        data._rev = 0
        this.db.push(data)

        return {
            ok: true,
            id: data._id,
            rev: data._rev
        }
    }
    async find(query) {
        query = query || {}
        const operator = {
            "$eq": (v1, v2) => v1 == v2,
            "$gte": (v1, v2) => v1 >= v2,
            "$lte": (v1, v2) => v1 <= v2,
            "$gt": (v1, v2) => v1 > v2,
            "$lt": (v1, v2) => v1 < v2
        }
        let paths = dottie.paths(query.selector || {})
        let r = this.db.filter(d => {
            return paths.reduce((r, p) => {
                return r ? operator[p.split(".").pop()](dottie.get(query.selector, p), dottie.get(d, p.split(".").slice(0, -1).join("."))) : r
            }, true)
        })

        return JSON.parse(JSON.stringify(r))
    }
    async destroy(query) {
        let r = await this.find(query)
        r.forEach(d => {
            this.db.splice(this.db.findIndex(c => c._id == d._id), 1)
        })
        return r.length
    }
}

module.exports = {
    CouchDbStore,
    MemDbStore,
    Store,
    Document
}