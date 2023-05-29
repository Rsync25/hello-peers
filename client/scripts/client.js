import DHT from '@hyperswarm/dht-relay'
import Stream from '@hyperswarm/dht-relay/ws'
// @ts-ignore
import goodbye from 'graceful-goodbye'
// import * as BufferSource from 'buffer/'
import b4a from 'b4a'

import * as SDK from 'hyper-sdk'
import { RangeWatcher } from '@lejeunerenard/hyperbee-range-watcher-autobase'
import { BSON } from 'bson'
import { createMultiWriterDB } from './db.js'
import { setTodo, createTodo, configTodo, todoList } from './view.js'
const { crypto, WebSocket } = window

let resolveReady
const ready = new Promise(resolve => (resolveReady = resolve))
ready.then(_ => console.log('all set up'))

const socket = new WebSocket('ws://localhost:3400')
const dht = new DHT(new Stream(true, socket))

const sdk = await SDK.create({
  storage: false,
  autoJoin: false,
  swarmOpts: {
    dht
  }
})

const topicBuffer = await crypto.subtle.digest('SHA-256', b4a.from('say a good hello', 'hex')).then(b4a.from)

const discovery = await sdk.get(topicBuffer)

discovery.on('peer-add', peerInfo => {
  console.log('new peer, peer:', peerInfo, 'peer count:', discovery.peers.length)
})

const db = await createMultiWriterDB(sdk, discovery)
goodbye(async () => {
  await db.close()
  await discovery.close()
  await sdk.close()
})
const todoCollection = db.collection('todo')
await todoCollection.createIndex(['text'])
await todoCollection.createIndex(['done', 'text'])
// ready.then(createWatcher)

db.autobase.on('append', async () => {
  for await (const todo of todoCollection.find()) {
    const todoElement = document.getElementById(todo._id.toString())
    if (!todoElement) setTodo(todo)
    else {
      const toReplaceWith = createTodo(todo)
      if (todoElement.innerHTML === toReplaceWith.innerHTML) continue
      todoElement.replaceWith(toReplaceWith)
      configTodo(todo)
    }
  }
  todoList.querySelectorAll('section').forEach(todo =>
    todoCollection.find({ _id: todo.id }).then(query => {
      if (query.length === 0) todo.remove()
    })
  )
})

resolveReady()

sdk.joinCore(discovery).then(() => console.log('discovering'))

export function addTodo (todo) {
  ready.then(() => todoCollection.insert(todo))
}
export function toggleTodo (_id) {
  return todoCollection.find({ _id }).then(([todo]) => {
    if (todo.done) return todoCollection.update({ _id }, { done: false })
    else return todoCollection.update({ _id }, { done: true })
  })
}
export function deleteTodo (_id) {
  return todoCollection.delete({ _id })
}

function createWatcher () {
  return new RangeWatcher(db.autobase.view, {}, null, updateStream)
}
async function updateStream (node) {
  const { key, value, type } = node
  console.log('watched saw', {
    key: String.fromCharCode(...key).split('\u0000').join('/'),
    value: String.fromCharCode(...key).split('\u0000').join('/'),
    type
  })
  if (b4a.includes(key, 'doc')) {
    const doc = BSON.deserialize(value)
    const todoElement = document.getElementById(doc._id.toString())
    if (type === 'put') {
      if (!todoElement) return setTodo(doc)
      const toReplaceWith = createTodo(doc)
      if (todoElement.innerHTML === toReplaceWith.innerHTML) return
      todoElement.replaceWith(toReplaceWith)
      configTodo(doc)
    }
    if (type === 'del') {
      todoElement.remove()
    }
  }
}
