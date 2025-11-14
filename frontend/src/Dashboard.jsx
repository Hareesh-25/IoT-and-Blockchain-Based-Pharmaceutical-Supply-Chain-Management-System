import React,{useState,useEffect}from'react'
import {API}from'./api'

export default function Dashboard({role}){
  const[batchId,setBatchId]=useState('BATCH-1001')
  const[trace,setTrace]=useState([])
  const[alerts,setAlerts]=useState([])
  const[blocks,setBlocks]=useState([])

  useEffect(()=>{fetchAlerts();fetchBlocks();},[])

  function fetchTrace(){API.getBatch(batchId).then(d=>setTrace(d.events||[]))}
  function fetchAlerts(){API.getAlerts().then(a=>setAlerts(a||[]))}
  function fetchBlocks(){API.getBlocks().then(b=>setBlocks(b.chain||[]))}

  async function doTransfer(){await API.transfer({from:role,to:'Next',batchId,actor:role});fetchTrace();fetchBlocks()}
  async function requestFDA(){await API.fdaRequest({batchId,manufacturerId:'MANU-1'});fetchTrace();fetchBlocks()}
  async function approveFDA(){await API.fdaApprove({batchId,approvedBy:'FDA-1'});fetchTrace();fetchBlocks()}

  return(
    <div style={{marginTop:20}}>
      <div>
        <input value={batchId} onChange={e=>setBatchId(e.target.value)}/>
        <button onClick={fetchTrace}>Trace</button>
        <button onClick={doTransfer}>Create Transfer</button>
        {role==='Manufacturer'&&<button onClick={requestFDA}>Request FDA</button>}
        {role==='FDA'&&<button onClick={approveFDA}>Approve FDA</button>}
      </div>

      <h3>Trace events</h3>
      <ul>{trace.map((e,i)=><li key={i}><b>{e.kind}</b> — {JSON.stringify(e.tx||e.payload||e.data||e)}</li>)}</ul>

      <h3>Alerts</h3>
      <ul>{alerts.map(a=><li key={a.id}>{a.batchId} — {a.warnings.join(', ')}</li>)}</ul>

      <h3>Ledger (latest blocks)</h3>
      <div style={{maxHeight:200,overflow:'auto',border:'1px solid #ddd',padding:8}}>
        {blocks.slice(-5).map(b=>
          <div key={b.index}>
            <div><b>Block #{b.index}</b> — txs: {b.transactions.length}</div>
            <div style={{fontSize:12}}>hash: {b.hash}</div>
          </div>)}
      </div>
    </div>
  )
}
