const {
    Document,
    CouchDbStore,
    MemDbStore
} = require("./model")
const nano = require("nano")('http://admin:mypass123@localhost:5983');

const test = nano.db.use("test")

let doc
const run = async () => {
    let test = []
    let project = {id: 1}
    doc = new Document(new MemDbStore(test))
    doc.commit({id:1}, {author:"doc"})
    doc._id = project.id
    return await doc.push()
}

run().then(console.log).catch(console.error)

/** 
 * 和git的区别
 * 1. 数据属性无状态区别，git 中文件有跟踪与未跟踪以及提交状态。
 *  而此服务无状态，所以project的数据只能通过commit接口更新
 * 2. 结构树未反向关联版本hash，这将说明在pull自动合并时对同一属性的历史版本的修改将被认为是一个冲突
 * 3. 删除了git中的分支与tag概念，只保留一个latest的别名指向最新的版本。
 *  且在checkout的时候只会返回一个project的版本数据而不修改当前实例的project
 * 4. 对于push时的冲突，使用数据库级别的乐观锁
*/

/** 
 * 数组存储子树中
 * pull 时只获取当前 project
 * push 时增量更新
 * 增加本地缓存
*/