// Chats live in Neon (Postgres), accessed through Prisma. The tables are in prisma/schema.prisma.
import { PrismaNeon } from "@prisma/adapter-neon";
import type { Message } from "@agent/ai";
import type { AgentEvent, ChatSummary } from "@agent/shared";
import { PrismaClient } from "../generated/client";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (your Neon connection string)");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });

export type Chat = { id: string; messages: Message[]; events: AgentEvent[] };

export async function createChat(id: string, title: string) {
  await prisma.chat.create({ data: { id, title } });
}

export async function getChat(id: string): Promise<Chat | undefined> {
  const chat = await prisma.chat.findUnique({
    where: { id },
    include: { events: { orderBy: { id: "asc" } } },
  });
  if (!chat) return undefined;
  // Json columns come back untyped; we only ever store these shapes in them.
  return {
    id: chat.id,
    messages: chat.messages as unknown as Message[],
    events: chat.events.map((e) => e.data as unknown as AgentEvent),
  };
}

/** Add this run's events to the chat. Pass `messages` only when the run succeeded: it replaces the model's history. */
export async function saveChat(id: string, events: AgentEvent[], messages?: Message[]) {
  // ponytail: the whole message history is rewritten on each run. Fine for normal chats.
  await prisma.$transaction([
    prisma.chatEvent.createMany({ data: events.map((e) => ({ chatId: id, data: e as object })) }),
    prisma.chat.update({ where: { id }, data: { messages: messages as object[] | undefined } }),
  ]);
}

export async function listChats(): Promise<ChatSummary[]> {
  return prisma.chat.findMany({
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}
