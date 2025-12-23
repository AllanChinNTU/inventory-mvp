// auth.js - fake login + RBAC
import { loadDb } from "./db.js";

const SESSION_KEY = "INV_MVP_SESSION_V2";

export function getSession(){
  return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
}
export function setSession(s){
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
export function clearSession(){
  sessionStorage.removeItem(SESSION_KEY);
}

export function login(username, password){
  const db = loadDb();
  const u = db.users.find(x => x.username === username && x.password === password);
  if(!u) throw new Error("帳號或密碼錯誤");
  const session = { userId: u.id, username: u.username, role: u.role, loginAt: new Date().toISOString() };
  setSession(session);
  return session;
}

export function currentUser(){
  const s = getSession();
  if(!s) return null;
  const db = loadDb();
  const u = db.users.find(x => x.id === s.userId);
  return u ? { id: u.id, username: u.username, role: u.role } : null;
}

// role-based access
export const Roles = {
  MANAGER: "manager",
  TECH: "tech",
  GUEST: "guest"
};

export function can(actor, action){
  // actions: "MASTER_WRITE", "TX_WRITE", "RESET", "IO"
  if(!actor) return false;
  if(actor.role === Roles.MANAGER) return true;
  if(actor.role === Roles.TECH){
    return ["TX_WRITE"].includes(action);
  }
  if(actor.role === Roles.GUEST){
    return []; // view only
  }
  return false;
}
