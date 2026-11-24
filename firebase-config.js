import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// นำค่า firebaseConfig จาก Firebase Console มาวางแทนที่ตรงนี้
const firebaseConfig = {
  apiKey: "AIzaSyByJrmuhmQZW3auMJZf-qwyxJUofDFjFJM",
  authDomain: "medreminder-3405f.firebaseapp.com",
  projectId: "medreminder-3405f",
  storageBucket: "medreminder-3405f.firebasestorage.app",
  messagingSenderId: "1018470927029",
  appId: "1:1018470927029:web:8d7f1642f9a523434f8cfc",
  measurementId: "G-77XJBRCENR"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);