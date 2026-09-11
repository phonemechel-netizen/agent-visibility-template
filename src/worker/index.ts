/**
 * Agent Visibility Worker + WhatsApp Business AI
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import {
	renderIndexJson,
	renderLlmsFullTxt,
	renderLlmsTxt,
	renderResourceJsonLd,
	renderResourceMd,
	renderRobotsTxt,
	renderWebsiteJsonLd,
} from "../enrichment/surfaces";

import {
	clearCache,
	getResources,
	siteConfig,
	upsertResource,
} from "../lib/store";

import type { Env, RawResource } from "../lib/types";

import {
	directoryDocument,
	SAMPLE_AGENT_KEYS,
	verifyAgentIdentity,
} from "../lib/web-bot-auth";

const app = new Hono<{ Bindings: Env }>();

const FIREBASE_PROJECT_ID = "xcoinsfree";

const MAX_BODY_BYTES = 100_000;
const MAX_RESOURCES = 100;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.onError((err, c) => {
	console.error(
		`[Error] ${c.req.method} ${c.req.path}: ${err.message}`,
	);

	if (/\.(md|txt)$/.test(c.req.path)) {
		return c.text("Internal server error", 500);
	}

	return c.json(
		{
			error: "Internal server error",
		},
		500,
	);
});

// ============================================================================
// HELPERS
// ============================================================================

function originOf(url: string): string {
	return new URL(url).origin;
}

function isAuthorized(c: {
	env: Env;
	req: {
		header: (name: string) => string | undefined;
	};
}): boolean {
	const configured = c.env.ADMIN_TOKEN;

	if (!configured) {
		return false;
	}

	const header = c.req.header("authorization") ?? "";

	const token = header.replace(
		/^Bearer\s+/i,
		"",
	);

	return token.length > 0 && token === configured;
}

function contentSignal(c: {
	env: Env;
}): Record<string, string> {
	return {
		"Content-Signal":
			c.env.CONTENT_SIGNAL ||
			"ai-input=yes, search=yes, ai-train=no",
	};
}

// ============================================================================
// CORS
// ============================================================================

app.use("/llms.txt", cors());
app.use("/llms-full.txt", cors());
app.use("/index.json", cors());
app.use("/jsonld", cors());

app.use("/:file{.+\\.md}", cors());
app.use("/:file{.+\\.jsonld}", cors());

// ============================================================================
// AGENT VISIBILITY
// ============================================================================

app.get("/llms.txt", async (c) => {
	const site = siteConfig(
		c.env,
		originOf(c.req.url),
	);

	const resources = await getResources(c.env);

	return c.text(
		renderLlmsTxt({
			site,
			resources,
		}),
		200,
		{
			"Content-Type":
				"text/plain; charset=utf-8",
			...contentSignal(c),
		},
	);
});

app.get("/llms-full.txt", async (c) => {
	const site = siteConfig(
		c.env,
		originOf(c.req.url),
	);

	const resources = await getResources(c.env);

	return c.text(
		renderLlmsFullTxt({
			site,
			resources,
		}),
		200,
		{
			"Content-Type":
				"text/plain; charset=utf-8",
			...contentSignal(c),
		},
	);
});

app.get("/index.json", async (c) => {
	const site = siteConfig(
		c.env,
		originOf(c.req.url),
	);

	const resources = await getResources(c.env);

	c.header(
		"Content-Signal",
		contentSignal(c)["Content-Signal"],
	);

	return c.json(
		renderIndexJson({
			site,
			resources,
		}),
	);
});

app.get("/robots.txt", async (c) => {
	const site = siteConfig(
		c.env,
		originOf(c.req.url),
	);

	const resources = await getResources(c.env);

	return c.text(
		renderRobotsTxt({
			site,
			resources,
			contentSignal:
				contentSignal(c)["Content-Signal"],
		}),
		200,
		{
			"Content-Type":
				"text/plain; charset=utf-8",
			...contentSignal(c),
		},
	);
});

app.get("/jsonld", async (c) => {
	const site = siteConfig(
		c.env,
		originOf(c.req.url),
	);

	const resources = await getResources(c.env);

	return c.json(
		renderWebsiteJsonLd({
			site,
			resources,
		}),
		200,
		{
			"Content-Type":
				"application/ld+json; charset=utf-8",
			...contentSignal(c),
		},
	);
});

// ============================================================================
// MARKDOWN RESOURCE
// ============================================================================

app.get("/:file{.+\\.md}", async (c) => {
	const slug = c.req
		.param("file")
		.replace(/\.md$/, "");

	const site = siteConfig(
		c.env,
		originOf(c.req.url),
	);

	const resources = await getResources(c.env);

	const resource = resources.find(
		(r) => r.slug === slug,
	);

	if (!resource) {
		return c.notFound();
	}

	return c.text(
		renderResourceMd({
			resource,
			site,
		}),
		200,
		{
			"Content-Type":
				"text/markdown; charset=utf-8",
			...contentSignal(c),
		},
	);
});

// ============================================================================
// JSON-LD RESOURCE
// ============================================================================

app.get("/:file{.+\\.jsonld}", async (c) => {
	const slug = c.req
		.param("file")
		.replace(/\.jsonld$/, "");

	const site = siteConfig(
		c.env,
		originOf(c.req.url),
	);

	const resources = await getResources(c.env);

	const resource = resources.find(
		(r) => r.slug === slug,
	);

	if (!resource) {
		return c.notFound();
	}

	return c.json(
		renderResourceJsonLd({
			resource,
			site,
		}),
		200,
		{
			"Content-Type":
				"application/ld+json; charset=utf-8",
			...contentSignal(c),
		},
	);
});

// ============================================================================
// EXISTING API
// ============================================================================

app.get("/api/site", async (c) => {
	const site = siteConfig(
		c.env,
		originOf(c.req.url),
	);

	return c.json({
		site,

		webBotAuthEnabled:
			c.env.ENABLE_WEB_BOT_AUTH === "true",

		surfaces: [
			{
				id: "llms-txt",
				label: "llms.txt",
				path: "/llms.txt",
				kind: "text",
			},
			{
				id: "llms-full",
				label: "llms-full.txt",
				path: "/llms-full.txt",
				kind: "text",
			},
			{
				id: "index-json",
				label: "index.json",
				path: "/index.json",
				kind: "json",
			},
			{
				id: "robots",
				label: "robots.txt",
				path: "/robots.txt",
				kind: "text",
			},
			{
				id: "jsonld",
				label: "JSON-LD",
				path: "/jsonld",
				kind: "json",
			},
		],
	});
});

app.get("/api/resources", async (c) => {
	const resources = await getResources(c.env);

	return c.json({
		count: resources.length,
		resources,
	});
});

app.get("/api/resources/:slug", async (c) => {
	const resources = await getResources(c.env);

	const resource = resources.find(
		(r) => r.slug === c.req.param("slug"),
	);

	if (!resource) {
		return c.json(
			{
				error: "Not found",
			},
			404,
		);
	}

	return c.json(resource);
});

app.post("/api/resources", async (c) => {
	if (!isAuthorized(c)) {
		return c.json(
			{
				error:
					"Unauthorized. Set the ADMIN_TOKEN secret.",
			},
			401,
		);
	}

	const body =
		await c.req
			.json<Partial<RawResource>>()
			.catch(() => null);

	if (!body?.slug || !body?.body) {
		return c.json(
			{
				error:
					"Missing required fields: slug, body",
			},
			400,
		);
	}

	const slug = String(body.slug);

	if (!SLUG_RE.test(slug)) {
		return c.json(
			{
				error:
					"Invalid slug: use 1–63 chars of [a-z0-9-].",
			},
			400,
		);
	}

	const rawBody = String(body.body);

	if (
		new TextEncoder().encode(rawBody).length >
		MAX_BODY_BYTES
	) {
		return c.json(
			{
				error:
					`Body too large (max ${MAX_BODY_BYTES} bytes).`,
			},
			400,
		);
	}

	let url = `${originOf(c.req.url)}/${slug}`;

	if (body.url) {
		try {
			const parsed = new URL(
				String(body.url),
			);

			if (
				parsed.protocol !== "http:" &&
				parsed.protocol !== "https:"
			) {
				return c.json(
					{
						error: "url must be http(s).",
					},
					400,
				);
			}

			url = parsed.toString();
		} catch {
			return c.json(
				{
					error: "url is not a valid URL.",
				},
				400,
			);
		}
	}

	const raw: RawResource = {
		slug,
		url,
		title: body.title
			? String(body.title).slice(0, 200)
			: undefined,
		body: rawBody,
	};

	try {
		const enriched = await upsertResource(
			c.env,
			raw,
			MAX_RESOURCES,
		);

		return c.json(
			enriched,
			201,
		);
	} catch (err) {
		if (
			(err as Error).message ===
			"RESOURCE_LIMIT"
		) {
			return c.json(
				{
					error:
						`Resource limit reached (max ${MAX_RESOURCES}).`,
				},
				409,
			);
		}

		throw err;
	}
});

app.post("/api/refresh", async (c) => {
	if (!isAuthorized(c)) {
		return c.json(
			{
				error:
					"Unauthorized. Set the ADMIN_TOKEN secret.",
			},
			401,
		);
	}

	await clearCache(c.env);

	return c.json({
		ok: true,
		message:
			"Cache cleared; surfaces will re-enrich.",
	});
});

// ============================================================================
// FIREBASE / FIRESTORE
// ============================================================================

interface FirebaseServiceAccount {
	project_id: string;
	client_email: string;
	private_key: string;
}

interface FirestoreValue {
	stringValue?: string;
	integerValue?: string;
	doubleValue?: number;
	booleanValue?: boolean;
	timestampValue?: string;
	nullValue?: null;

	mapValue?: {
		fields?: Record<string, FirestoreValue>;
	};

	arrayValue?: {
		values?: FirestoreValue[];
	};
}

interface FirestoreDocument {
	name?: string;
	fields?: Record<string, FirestoreValue>;
	createTime?: string;
	updateTime?: string;
}

function firestoreToObject(
	fields?: Record<string, FirestoreValue>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	if (!fields) {
		return result;
	}

	for (const [key, value] of Object.entries(fields)) {
		if (value.stringValue !== undefined) {
			result[key] = value.stringValue;
	} else if (
			value.integerValue !== undefined
		) {
			result[key] = Number(
				value.integerValue,
			);
		} else if (
			value.doubleValue !== undefined
		) {
			result[key] = value.doubleValue;
		} else if (
			value.booleanValue !== undefined
		) {
			result[key] = value.booleanValue;
		} else if (
			value.timestampValue !== undefined
		) {
			result[key] = value.timestampValue;
		} else if (
			value.nullValue === null
		) {
			result[key] = null;
		} else if (
			value.mapValue
		) {
			result[key] =
				firestoreToObject(
					value.mapValue.fields,
				);
		} else if (
			value.arrayValue
		) {
			result[key] =
				(value.arrayValue.values ?? [])
					.map((item) =>
						firestoreValueToPlain(
							item,
						),
					);
		}
	}

	return result;
}

function firestoreValueToPlain(
	value: FirestoreValue,
): unknown {
	if (value.stringValue !== undefined) {
		return value.stringValue;
	}

	if (value.integerValue !== undefined) {
		return Number(value.integerValue);
	}

	if (value.doubleValue !== undefined) {
		return value.doubleValue;
	}

	if (value.booleanValue !== undefined) {
		return value.booleanValue;
	}

	if (value.timestampValue !== undefined) {
		return value.timestampValue;
	}

	if (value.nullValue === null) {
		return null;
	}

	if (value.mapValue) {
		return firestoreToObject(
			value.mapValue.fields,
		);
	}

	if (value.arrayValue) {
		return (value.arrayValue.values ?? []).map(
			(item) =>
				firestoreValueToPlain(item),
		);
	}

	return null;
}

function firestoreValue(
	value: unknown,
): FirestoreValue {
	if (value === null) {
		return {
			nullValue: null,
		};
	}

	if (typeof value === "boolean") {
		return {
			booleanValue: value,
		};
	}

	if (typeof value === "number") {
		if (Number.isInteger(value)) {
			return {
				integerValue: String(value),
			};
		}

		return {
			doubleValue: value,
		};
	}

	if (typeof value === "string") {
		return {
			stringValue: value,
		};
	}

	if (Array.isArray(value)) {
		return {
			arrayValue: {
				values: value.map(
					firestoreValue,
				),
			},
		};
	}

	if (
		typeof value === "object" &&
		value !== null
	) {
		const fields: Record<
			string,
			FirestoreValue
		> = {};

		for (const [
			key,
			item,
		] of Object.entries(
			value as Record<string, unknown>,
		)) {
			fields[key] =
				firestoreValue(item);
		}

		return {
			mapValue: {
				fields,
			},
		};
	}

	return {
		stringValue: String(value),
	};
}

// ============================================================================
// BASE64
// ============================================================================

function base64UrlEncode(
	data:
		| ArrayBuffer
		| Uint8Array
		| string,
): string {
	let bytes: Uint8Array;

	if (typeof data === "string") {
		bytes = new TextEncoder().encode(
			data,
		);
	} else if (data instanceof Uint8Array) {
		bytes = data;
	} else {
		bytes = new Uint8Array(data);
	}

	let binary = "";

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function pemToArrayBuffer(
	pem: string,
): ArrayBuffer {
	const base64 = pem
		.replace(
			/-----BEGIN PRIVATE KEY-----/g,
			"",
		)
		.replace(
			/-----END PRIVATE KEY-----/g,
			"",
		)
		.replace(/\s/g, "");

	const binary = atob(base64);

	const bytes = new Uint8Array(
		binary.length,
	);

	for (
		let i = 0;
		i < binary.length;
		i++
	) {
		bytes[i] =
			binary.charCodeAt(i);
	}

	return bytes.buffer;
}

// ============================================================================
// FIREBASE OAUTH
// ============================================================================

async function getFirebaseAccessToken(
	env: Env,
): Promise<string> {
	const raw =
		env.FIREBASE_SERVICE_ACCOUNT_JSON;

	if (!raw) {
		throw new Error(
			"FIREBASE_SERVICE_ACCOUNT_JSON is missing",
		);
	}

	let serviceAccount: FirebaseServiceAccount;

	try {
		serviceAccount =
			JSON.parse(
				raw,
			) as FirebaseServiceAccount;
	} catch {
		throw new Error(
			"FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON",
		);
	}

	const now =
		Math.floor(
			Date.now() / 1000,
		);

	const header = {
		alg: "RS256",
		typ: "JWT",
	};

	const claim = {
		iss: serviceAccount.client_email,

		scope:
			"https://www.googleapis.com/auth/datastore",

		aud:
			"https://oauth2.googleapis.com/token",

		iat: now,

		exp: now + 3600,
	};

	const encodedHeader =
		base64UrlEncode(
			JSON.stringify(header),
		);

	const encodedClaim =
		base64UrlEncode(
			JSON.stringify(claim),
		);

	const unsignedToken =
		`${encodedHeader}.${encodedClaim}`;

	const privateKey =
		await crypto.subtle.importKey(
			"pkcs8",
			pemToArrayBuffer(
				serviceAccount.private_key,
			),
			{
				name:
					"RSASSA-PKCS1-v1_5",
				hash: "SHA-256",
			},
			false,
			["sign"],
		);

	const signature =
		await crypto.subtle.sign(
			"RSASSA-PKCS1-v1_5",
			privateKey,
			new TextEncoder().encode(
				unsignedToken,
			),
		);

	const jwt =
		`${unsignedToken}.${base64UrlEncode(signature)}`;

	const tokenResponse =
		await fetch(
			"https://oauth2.googleapis.com/token",
			{
				method: "POST",

				headers: {
					"Content-Type":
						"application/x-www-form-urlencoded",
				},

				body:
					"grant_type=" +
					encodeURIComponent(
						"urn:ietf:params:oauth:grant-type:jwt-bearer",
					) +
					"&assertion=" +
					encodeURIComponent(jwt),
			},
		);

	if (!tokenResponse.ok) {
		const errorText =
			await tokenResponse.text();

		throw new Error(
			`Firebase OAuth error ${tokenResponse.status}: ${errorText}`,
		);
	}

	const tokenData =
		(await tokenResponse.json()) as {
			access_token?: string;
		};

	if (!tokenData.access_token) {
		throw new Error(
			"Firebase OAuth did not return access_token",
		);
	}

	return tokenData.access_token;
}

// ============================================================================
// FIRESTORE REQUEST
// ============================================================================

async function firestoreRequest(
	env: Env,
	path: string,
	options: RequestInit = {},
): Promise<Response> {
	const token =
		await getFirebaseAccessToken(env);

	const base =
		`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

	const url = path.endsWith(":runQuery")
		? `${base}:runQuery`
		: `${base}/${path}`;

	return fetch(
		url,
		{
			...options,

			headers: {
				Authorization:
					`Bearer ${token}`,

				"Content-Type":
					"application/json",

				...(options.headers ?? {}),
			},
		},
	);
}
// ============================================================================
// BUSINESS
// ============================================================================

async function getBusinessDocument(
	businessId: string,
	env: Env,
): Promise<Record<string, unknown> | null> {
	const response =
		await firestoreRequest(
			env,
			`businesses/${encodeURIComponent(
				businessId,
			)}`,
		);

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		const text =
			await response.text();

		throw new Error(
			`Firestore business error ${response.status}: ${text}`,
		);
	}

	const document =
		(await response.json()) as FirestoreDocument;

	return firestoreToObject(
		document.fields,
	);
}

// ============================================================================
// PRODUCTS
// ============================================================================

interface Product {
	id: string;
	businessId?: string;
	ownerId?: string;
	name: string;
	description?: string;
	price: number;
	stock: number;
	category?: string;
	active?: boolean;
}

async function getBusinessProducts(
	businessId: string,
	env: Env,
): Promise<Product[]> {
	const response =
		await firestoreRequest(
			env,
			"documents:runQuery",
			{
				method: "POST",

				body: JSON.stringify({
					structuredQuery: {
						from: [
							{
								collectionId:
									"products",
							},
						],

						where: {
							fieldFilter: {
								field: {
									fieldPath:
										"ownerId",
								},

								op:
									"EQUAL",

								value: {
									stringValue:
										businessId,
								},
							},
						},

						limit: 200,
					},
				}),
			},
		);

	if (!response.ok) {
		const text =
			await response.text();

		throw new Error(
			`Firestore products error ${response.status}: ${text}`,
		);
	}

	const rows =
		(await response.json()) as Array<{
			document?: FirestoreDocument;
		}>;

	const products: Product[] = [];

	for (const row of rows) {
		if (!row.document) {
			continue;
		}

		const data =
			firestoreToObject(
				row.document.fields,
			);

		const id =
			row.document.name
				?.split("/")
				.pop() ?? "";

		const name =
			String(
				data.name ??
					data.title ??
					"Product",
			);

		const price =
			Number(
				data.price ??
					data.amount ??
					0,
			);

		const stock =
			Number(
				data.stock ??
					data.quantity ??
					0,
			);

		products.push({
			id,

			businessId:
				data.businessId
					? String(
							data.businessId,
						)
					: undefined,

			ownerId:
				data.ownerId
					? String(
							data.ownerId,
						)
					: undefined,

			name,

			description:
				data.description
					? String(
							data.description,
						)
					: undefined,

			price,

			stock,

			category:
				data.category
					? String(
							data.category,
						)
					: undefined,

			active:
				data.active === undefined
					? true
					: Boolean(data.active),
		});
	}

	return products;
}

// ============================================================================
// WHATSAPP WEBHOOK VERIFICATION
// ============================================================================

app.get("/webhook", async (c) => {
	const mode =
		c.req.query("hub.mode");

	const token =
		c.req.query(
			"hub.verify_token",
		);

	const challenge =
		c.req.query(
			"hub.challenge",
		);

	console.log(
		"WhatsApp webhook verification:",
		{
			mode,
			hasToken: Boolean(token),
			hasChallenge:
				Boolean(challenge),
		},
	);

	if (
		mode === "subscribe" &&
		token &&
		token === c.env.META_VERIFY_TOKEN
	) {
		return new Response(
			challenge ?? "",
			{
				status: 200,

				headers: {
					"Content-Type":
						"text/plain; charset=utf-8",
				},
			},
		);
	}

	return new Response(
		"Forbidden",
		{
			status: 403,
		},
	);
});

// ============================================================================
// META SIGNATURE
// ============================================================================

async function verifyMetaSignature(
	request: Request,
	body: string,
	appSecret: string,
): Promise<boolean> {
	const signature =
		request.headers.get(
			"x-hub-signature-256",
		);

	if (!signature) {
		return false;
	}

	if (
		!signature.startsWith(
			"sha256=",
		)
	) {
		return false;
	}

	const receivedHex =
		signature.slice(7);

	const key =
		await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(
				appSecret,
			),
			{
				name: "HMAC",
				hash: "SHA-256",
			},
			false,
			["sign"],
		);

	const signed =
		await crypto.subtle.sign(
			"HMAC",
			key,
			new TextEncoder().encode(
				body,
			),
		);

	const expectedHex =
		Array.from(
			new Uint8Array(signed),
		)
			.map((byte) =>
				byte
					.toString(16)
					.padStart(2, "0"),
			)
			.join("");

	if (
		receivedHex.length !==
		expectedHex.length
	) {
		return false;
	}

	let difference = 0;

	for (
		let i = 0;
		i < expectedHex.length;
		i++
	) {
		difference |=
			receivedHex.charCodeAt(i) ^
			expectedHex.charCodeAt(i);
	}

	return difference === 0;
}

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

function normalizeText(
	text: string,
): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(
			/[\u0300-\u036f]/g,
			"",
		)
		.replace(
			/[^\p{L}\p{N}\s.-]/gu,
			" ",
		)
		.replace(/\s+/g, " ")
		.trim();
}

// ============================================================================
// MESSAGE PARSER
// ============================================================================

interface ParsedCustomerMessage {
	productText: string;
	quantity: number;
}

function parseCustomerMessage(
	text: string,
): ParsedCustomerMessage {
	const original =
		text.trim();

	let quantity = 1;

	const quantityPatterns = [
		/\b(\d+)\s*(?:x|pcs?|pieces?|units?|unites?)\b/i,

		/\b(?:qty|quantity|quantite)\s*[:=]?\s*(\d+)\b/i,
	];

	for (const pattern of quantityPatterns) {
		const match =
			original.match(pattern);

		if (match) {
			quantity =
				Math.max(
					1,
					Number(match[1]),
				);

			const cleaned =
				original
					.replace(
						match[0],
						" ",
					)
					.trim();

			return {
				productText:
					cleaned,
				quantity,
			};
		}
	}

	const numberMatch =
		original.match(
			/\b(\d+)\b/,
		);

	if (numberMatch) {
		const number =
			Number(numberMatch[1]);

		if (
			Number.isFinite(number) &&
			number > 0 &&
			number <= 1000
		) {
			quantity = number;

			const cleaned =
				original
					.replace(
						numberMatch[0],
						" ",
					)
					.trim();

			return {
				productText:
					cleaned,
				quantity,
			};
		}
	}

	return {
		productText: original,
		quantity,
	};
}

// ============================================================================
// FIND PRODUCT
// ============================================================================

function findProduct(
	products: Product[],
	searchText: string,
): Product | null {
	const normalized =
		normalizeText(searchText);

	if (!normalized) {
		return null;
	}

	const exact =
		products.find(
			(product) =>
				normalizeText(
					product.name,
				) === normalized,
		);

	if (exact) {
		return exact;
	}

	const contains =
		products.find((product) => {
			const name =
				normalizeText(
					product.name,
				);

			return (
				name.includes(normalized) ||
				normalized.includes(name)
			);
		});

	if (contains) {
		return contains;
	}

	const words =
		normalized.split(" ");

	let best: Product | null = null;
	let bestScore = 0;

	for (const product of products) {
		const name =
			normalizeText(
				product.name,
			);

		let score = 0;

		for (const word of words) {
			if (
				word.length >= 2 &&
				name.includes(word)
			) {
				score++;
			}
		}

		if (score > bestScore) {
			bestScore = score;
			best = product;
		}
	}

	return best;
}

// ============================================================================
// FIRESTORE ORDER
// ============================================================================

async function createFirestoreOrder(
	env: Env,
	order: Record<string, unknown>,
): Promise<string> {
	const id =
		`wa_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

	const fields: Record<
		string,
		FirestoreValue
	> = {};

	for (const [
		key,
		value,
	] of Object.entries(order)) {
		fields[key] =
			firestoreValue(value);
	}

	const response =
		await firestoreRequest(
			env,
			`orders?documentId=${encodeURIComponent(id)}`,
			{
				method: "POST",

				body: JSON.stringify({
					fields,
				}),
			},
		);

	if (!response.ok) {
		const text =
			await response.text();

		throw new Error(
			`Firestore order error ${response.status}: ${text}`,
		);
	}

	return id;
}

// ============================================================================
// DUPLICATE ORDER
// ============================================================================

async function hasExistingOrder(
	env: Env,
	businessId: string,
	messageId: string,
): Promise<boolean> {
	const response =
		await firestoreRequest(
			env,
			"orders:runQuery",
			{
				method: "POST",

				body: JSON.stringify({
					structuredQuery: {
						from: [
							{
								collectionId:
									"orders",
							},
						],

						where: {
							compositeFilter: {
								op: "AND",

								filters: [
									{
										fieldFilter: {
											field: {
												fieldPath:
													"ownerId",
											},

											op:
												"EQUAL",

											value: {
												stringValue:
													businessId,
											},
										},
									},

									{
										fieldFilter: {
											field: {
												fieldPath:
													"whatsappMessageId",
											},

											op:
												"EQUAL",

											value: {
												stringValue:
													messageId,
											},
										},
									},
								],
							},
						},

						limit: 1,
					},
				}),
			},
		);

	if (!response.ok) {
		console.error(
			"Duplicate check failed:",
			await response.text(),
		);

		return false;
	}

	const rows =
		(await response.json()) as Array<{
			document?: FirestoreDocument;
		}>;

	return rows.some(
		(row) =>
			Boolean(row.document),
	);
}

// ============================================================================
// SEND WHATSAPP MESSAGE
// ============================================================================

async function sendWhatsAppMessage(
	env: Env,
	to: string,
	text: string,
): Promise<void> {
	const graphVersion =
		env.META_GRAPH_VERSION ||
		"v23.0";

	const phoneNumberId =
		env.META_PHONE_NUMBER_ID;

	if (!phoneNumberId) {
		throw new Error(
			"META_PHONE_NUMBER_ID is missing",
		);
	}

	if (!env.META_ACCESS_TOKEN) {
		throw new Error(
			"META_ACCESS_TOKEN is missing",
		);
	}

	const response =
		await fetch(
			`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
			{
				method: "POST",

				headers: {
					Authorization:
						`Bearer ${env.META_ACCESS_TOKEN}`,

					"Content-Type":
						"application/json",
				},

				body: JSON.stringify({
					messaging_product:
						"whatsapp",

					to,

					type: "text",

					text: {
						preview_url:
							false,

						body: text,
					},
				}),
			},
		);

	if (!response.ok) {
		const errorText =
			await response.text();

		throw new Error(
			`WhatsApp API error ${response.status}: ${errorText}`,
		);
	}
}

// ============================================================================
// PROCESS WHATSAPP MESSAGE
// ============================================================================

async function processWhatsAppMessage(
	env: Env,
	message: any,
	value: any,
): Promise<void> {
	const messageId =
		String(
			message?.id ?? "",
		);

	const from =
		String(
			message?.from ?? "",
		);

	if (!messageId || !from) {
		return;
	}

	if (
		message?.type !== "text"
	) {
		console.log(
			"Ignored non-text WhatsApp message:",
			message?.type,
		);

		return;
	}

	const customerText =
		String(
			message?.text?.body ?? "",
		).trim();

	if (!customerText) {
		return;
	}

	const businessId =
		env.BUSINESS_ID;

	if (!businessId) {
		throw new Error(
			"BUSINESS_ID is missing",
		);
	}

	const duplicate =
		await hasExistingOrder(
			env,
			businessId,
			messageId,
		);

	if (duplicate) {
		console.log(
			"Duplicate WhatsApp message ignored:",
			messageId,
		);

		return;
	}

	const business =
		await getBusinessDocument(
			businessId,
			env,
		);

	if (!business) {
		throw new Error(
			`Business not found: ${businessId}`,
		);
	}

	if (
		business.active === false
	) {
		await sendWhatsAppMessage(
			env,
			from,
			"Sorry, this business is currently unavailable.",
		);

		return;
	}

	const products =
		await getBusinessProducts(
			businessId,
			env,
		);

	const activeProducts =
		products.filter(
			(product) =>
				product.active !== false,
		);

	if (
		activeProducts.length === 0
	) {
		await sendWhatsAppMessage(
			env,
			from,
			"Sorry, there are currently no products available.",
		);

		return;
	}

	const parsed =
		parseCustomerMessage(
			customerText,
		);

	const product =
		findProduct(
			activeProducts,
			parsed.productText,
		);

	if (!product) {
		const list =
			activeProducts
				.slice(0, 10)
				.map(
					(item) =>
						`• ${item.name} — ${item.price}`,
				)
				.join("\n");

		await sendWhatsAppMessage(
			env,
			from,
			`Hello! 👋\n\nI couldn't find that product.\n\nAvailable products:\n${list}\n\nExample: "2 Oil Change"`,
		);

		return;
	}

	if (
		!Number.isFinite(
			product.stock,
		) ||
		product.stock <= 0
	) {
		await sendWhatsAppMessage(
			env,
			from,
			`Sorry, "${product.name}" is currently out of stock.`,
		);

		return;
	}

	if (
		parsed.quantity >
		product.stock
	) {
		await sendWhatsAppMessage(
			env,
			from,
			`Sorry, "${product.name}" has only ${product.stock} available. You requested ${parsed.quantity}.`,
		);

		return;
	}

	const total =
		product.price *
		parsed.quantity;

	const orderId =
		await createFirestoreOrder(
			env,
			{
				ownerId:
					businessId,

				businessId:
					businessId,

				businessName:
					String(
						business.name ??
							"",
					),

				customerWhatsapp:
					from,

				customerName:
					String(
						value?.contacts?.[0]
							?.profile?.name ??
							"",
					),

				whatsappMessageId:
					messageId,

				productId:
					product.id,

				productName:
					product.name,

				category:
					product.category ??
					"",

				quantity:
					parsed.quantity,

				unitPrice:
					product.price,

				total,

				status:
					"pending",

				source:
					"whatsapp",

				customerMessage:
					customerText,

				createdAt:
					new Date().toISOString(),
			},
		);

	const currency =
		typeof business.currency ===
		"string"
			? business.currency
			: "MAD";

	const reply =
		`✅ Order received!\n\n` +
		`Product: ${product.name}\n` +
		`Quantity: ${parsed.quantity}\n` +
		`Unit price: ${product.price} ${currency}\n` +
		`Total: ${total} ${currency}\n\n` +
		`Order ID: ${orderId}\n` +
		`Status: Pending\n\n` +
		`Thank you for contacting ${String(
			business.name ??
				"our business",
		)}.`;

	await sendWhatsAppMessage(
		env,
		from,
		reply,
	);
}

// ============================================================================
// WHATSAPP POST WEBHOOK
// ============================================================================

app.post("/webhook", async (c) => {
	const rawBody =
		await c.req.text();

	if (c.env.META_APP_SECRET) {
		const valid =
			await verifyMetaSignature(
				c.req.raw,
				rawBody,
				c.env.META_APP_SECRET,
			);

		if (!valid) {
			console.error(
				"Invalid WhatsApp webhook signature",
			);

			return c.json(
				{
					error:
						"Invalid signature",
				},
				401,
			);
		}
	}

	let payload: any;

	try {
		payload =
			JSON.parse(rawBody);
	} catch {
		return c.json(
			{
				error:
					"Invalid JSON",
			},
			400,
		);
	}

	console.log(
		"WhatsApp webhook received:",
		JSON.stringify(payload),
	);

	if (
		payload?.object !==
		"whatsapp_business_account"
	) {
		return c.json({
			ok: true,
			ignored: true,
		});
	}

	try {
		const entries =
			Array.isArray(
				payload.entry,
			)
				? payload.entry
				: [];

		for (const entry of entries) {
			const changes =
				Array.isArray(
					entry?.changes,
				)
					? entry.changes
					: [];

			for (const change of changes) {
				const value =
					change?.value;

				if (!value) {
					continue;
				}

				const messages =
					Array.isArray(
						value.messages,
					)
						? value.messages
						: [];

				for (const message of messages) {
					await processWhatsAppMessage(
						c.env,
						message,
						value,
					);
				}
			}
		}
	} catch (error) {
    console.error(
        "WhatsApp processing error:",
        error instanceof Error
            ? error.message
            : String(error)
    );

    console.error(
        "WhatsApp processing stack:",
        error instanceof Error
            ? error.stack
            : "no stack"
    );
}

	return c.json({
		ok: true,
	});
});

// ============================================================================
// WEB BOT AUTH
// ============================================================================

app.get(
	"/.well-known/web-bot-auth/directory",
	(c) => {
		if (
			c.env.ENABLE_WEB_BOT_AUTH !==
			"true"
		) {
			return c.notFound();
		}

		return c.json(
			directoryDocument(
				SAMPLE_AGENT_KEYS,
			),
		);
	},
);

app.all(
	"/api/identity",
	async (c) => {
		if (
			c.env.ENABLE_WEB_BOT_AUTH !==
			"true"
		) {
			return c.json(
				{
					error:
						"Web Bot Auth is disabled",
				},
				404,
			);
		}

		const result =
			await verifyAgentIdentity(
				c.req.raw,
				SAMPLE_AGENT_KEYS,
			);

		return c.json(result);
	},
);

// ============================================================================
// ROOT
// ============================================================================

app.get("/", (c) => {
	return c.json({
		ok: true,

		service:
			"Agent Visibility Worker + WhatsApp AI",

		webhook:
			"/webhook",
	});
});

// ============================================================================
// 404
// ============================================================================

app.notFound((c) => {
	return c.json(
		{
			error: "Not Found",
			path: c.req.path,
		},
		404,
	);
});

export default app;
