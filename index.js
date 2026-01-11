import 'dotenv/config';
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from "firebase/app";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, 
    increment, serverTimestamp, onSnapshot, collection, query, where 
} from "firebase/firestore";

// --- CONFIGURATION ---
const token = process.env.BOT_TOKEN;
const REWARD_AMOUNT = 500;

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase & Bot
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const bot = new TelegramBot(token, { polling: true });

// Express Server for health checks
const server = express();
server.get('/', (req, res) => res.send('Bot is running...'));
server.listen(3000);

// --- CORE FUNCTIONS ---

/**
 * Creates or merges user data in Firestore
 */
async function createOrEnsureUser(userId, firstName, photoURL, referralId) {
    const userRef = doc(db, "users", userId.toString());
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        await setDoc(userRef, {
            id: userId,
            name: firstName,
            photoURL: photoURL || "",
            coins: 0,
            reffer: 0,
            refferBy: referralId || null,
            tasksCompleted: 0,
            totalWithdrawals: 0,
            frontendOpened: false,
            rewardGiven: false
        }, { merge: true });
    }
}

/**
 * Processes the referral reward logic
 */
async function rewardReferrer(newUserDoc) {
    const userData = newUserDoc.data();
    const userId = newUserDoc.id;
    const referrerId = userData.refferBy;

    try {
        const referrerRef = doc(db, "users", referrerId.toString());
        
        // 1. Increment Referrer's stats
        await updateDoc(referrerRef, {
            coins: increment(REWARD_AMOUNT),
            reffer: increment(1)
        });

        // 2. Mark reward as given to prevent duplicate processing
        await updateDoc(doc(db, "users", userId), {
            rewardGiven: true
        });

        // 3. Create Ledger entry
        await setDoc(doc(db, "ref_rewards", userId), {
            userId: userId,
            referrerId: referrerId,
            reward: REWARD_AMOUNT,
            createdAt: serverTimestamp()
        });

        console.log(`✅ Reward given to ${referrerId} for inviting ${userId}`);
    } catch (error) {
        console.error("Referral Reward Error:", error);
    }
}

// --- REFERRAL WORKER (Listener Style) ---
// This listens for any user who has opened the app but hasn't had their reward processed yet
const q = query(
    collection(db, "users"), 
    where("frontendOpened", "==", true),
    where("rewardGiven", "==", false)
);

onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
        if (change.type === "added" || change.type === "modified") {
            const data = change.doc.data();
            // Final safety check: must have a referrer
            if (data.refferBy) {
                rewardReferrer(change.doc);
            }
        }
    });
});

// --- TELEGRAM BOT HANDLERS ---

bot.onText(/\/start (.+)/, async (msg, match) => {
    handleStart(msg, match[1]);
});

bot.onText(/\/start$/, async (msg) => {
    handleStart(msg, null);
});

async function handleStart(msg, refParam) {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    const userId = msg.from.id;
    
    // Attempt to get profile photo
    let photoURL = "";
    try {
        const photos = await bot.getUserProfilePhotos(userId);
        if (photos.total_count > 0) {
            const fileId = photos.photos[0][0].file_id;
            const file = await bot.getFile(fileId);
            photoURL = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        }
    } catch (e) { console.log("Photo fetch failed"); }

    // Logic for referral ID
    let referralId = null;
    if (refParam && refParam.startsWith('ref')) {
        referralId = refParam.replace('ref', '');
        // Prevent self-referral
        if (referralId === userId.toString()) referralId = null;
    }

    await createOrEnsureUser(userId, firstName, photoURL, referralId);

    const welcomeImg = "https://i.ibb.co/932298pT/file-32.jpg";
    const caption = `👋 Hi! Welcome ${firstName} ⭐\nYaha aap tasks complete karke real rewards kama sakte ho!\n\n🔥 Daily Tasks\n🔥 Video Watch\n🔥 Mini Apps\n🔥 Referral Bonus\n🔥 Auto Wallet System\n\nReady to earn?\nTap START and your journey begins!`;

    const options = {
        caption: caption,
        reply_markup: {
            inline_keyboard: [
                [{ text: "▶ Open App", web_app: { url: "https://angkurbasfor.github.io/Telegram-Web-App-Final/" } }],
                [{ text: "📢 Channel", url: "https://t.me/finisher_tech" }],
                [{ text: "🌐 Community", url: "https://t.me/finisher_techg" }]
            ]
        }
    };

    bot.sendPhoto(chatId, welcomeImg, options);
}

console.log("Backend Worker and Bot are online...");

