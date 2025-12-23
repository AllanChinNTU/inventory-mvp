// app.js - app bootstrap
import { initDbIfEmpty } from "./db.js";
import { login, currentUser, clearSession } from "./auth.js";
import { renderAll, bindAppEvents, applyRoleToUI } from "./ui.js";

const $ = (id) => document.getElementById(id);

function showLogin(msg=""){
  $("loginView").style.display = "block";
  $("appView").style.display = "none";
  $("whoami").textContent = "";
  if(msg) $("loginMsg").textContent = msg;
}

function showApp(actor){
  $("loginView").style.display = "none";
  $("appView").style.display = "grid";
  $("whoami").textContent = `${actor.username} (${actor.role})`;
}

function bootstrap(){
  initDbIfEmpty();

  // login events
  $("loginBtn").addEventListener("click", ()=>{
    try{
      const u = $("loginUser").value.trim();
      const p = $("loginPass").value;
      login(u, p);
      location.reload(); // simplest: reload to re-bootstrap with session
    }catch(err){
      $("loginMsg").textContent = err.message || "登入失敗";
    }
  });

  $("logoutBtn").addEventListener("click", ()=>{
    clearSession();
    location.reload();
  });

  const actor = currentUser();
  if(!actor){
    showLogin("請使用 tech/manager/guest 其中之一登入。");
    return;
  }

  showApp(actor);
  applyRoleToUI(actor);
  bindAppEvents(actor);
  renderAll();
}

bootstrap();
