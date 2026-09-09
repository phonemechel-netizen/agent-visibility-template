export interface RawResource {
	slug: string;
	url: string;
	title?: string;
	body: string;
}

export interface Resource {
	slug: string;
	url: string;
	title: string;
	summary: string;
	keyPoints: string[];
	topics: string[];
	category: string | null;
	content: string;
	updatedAt: string;
	model: string;
}

export interface SiteConfig {
	name: string;
	description: string;
	origin: string;
}

export interface Env {
	AI: Ai;
	VISIBILITY_CACHE: KVNamespace;

	SITE_NAME: string;
	SITE_DESCRIPTION: string;
	AI_MODEL: string;
	ENRICHMENT_CACHE_TTL: string;
	CONTENT_SIGNAL: string;
	ENABLE_WEB_BOT_AUTH: string;

	ADMIN_TOKEN?: string;

	// Firebase / Firestore
	FIREBASE_SERVICE_ACCOUNT_JSON: string;
	BUSINESS_ID: string;

	// Meta / WhatsApp
	META_VERIFY_TOKEN: string;
	META_APP_SECRET?: string;
	META_ACCESS_TOKEN: string;
	META_PHONE_NUMBER_ID: string;
	META_GRAPH_VERSION?: string;
}
