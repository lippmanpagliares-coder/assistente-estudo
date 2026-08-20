import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Pegue estes valores em: console.firebase.google.com > seu projeto >
// ícone de engrenagem > Configurações do projeto > "Seus apps" > SDK setup and configuration.
const firebaseConfig = {
  apiKey: "AIzaSyBakz8SBcCT4abpqxekamkbrf8MDlxhRmY",
  authDomain: "assistente-estudos-lps.firebaseapp.com",
  projectId: "assistente-estudos-lps",
  storageBucket: "assistente-estudos-lps.firebasestorage.app",
  messagingSenderId: "891426240021",
  appId: "1:891426240021:web:097d480c7ec27e0b9d001c",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
