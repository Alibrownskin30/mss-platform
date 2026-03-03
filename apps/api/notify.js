import nodemailer from "nodemailer";
import TelegramBot from "node-telegram-bot-api";

let bot = null;
if (process.env.TELEGRAM_TOKEN) {
bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
}

const transporter =
process.env.EMAIL_USER && process.env.EMAIL_PASS
? nodemailer.createTransport({
service: "gmail",
auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
})
: null;

export async function sendTelegram(chatId, message) {
if (!bot) throw new Error("Telegram not configured");
if (!chatId) throw new Error("Missing telegram_chat_id");
return bot.sendMessage(chatId, message);
}

export async function sendEmail(to, subject, text) {
if (!transporter) throw new Error("Email not configured");
return transporter.sendMail({
from: process.env.EMAIL_USER,
to,
subject,
text,
});
}
