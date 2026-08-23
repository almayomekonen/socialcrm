--
-- PostgreSQL database dump
--


-- Dumped from database version 18.1 (Homebrew)
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'AGNT',
    'OFFICE',
    'MNGR',
    'ADMIN',
    'GM',
    'EXT'
);


--
-- Name: family_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.family_status_enum AS ENUM (
    'נשוי/ה',
    'רווק/ה',
    'גרוש/ה',
    'אלמן/ה',
    'ידועים בציבור'
);


--
-- Name: gender_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gender_enum AS ENUM (
    'זכר',
    'נקבה'
);


--
-- Name: qna_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.qna_type AS ENUM (
    'RISK',
    'GEN'
);


--
-- Name: tagmul_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tagmul_type_enum AS ENUM (
    'היקף',
    'נפרעים'
);


--
-- Name: add_zeros_to_idnum(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_zeros_to_idnum() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."idNum" IS NOT NULL THEN
        NEW."idNum" := LPAD(NEW."idNum", 9, '0');
      END IF;
      RETURN NEW;
    END;
    $$;


--
-- Name: create_client_info_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_client_info_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
        BEGIN
          -- 'NEW.id' refers to the 'id' of the row just inserted into the 'clients' table
          INSERT INTO clients_info (id)
          VALUES (NEW.id);
          RETURN NEW;
        END;
        $$;


--
-- Name: create_user_info_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_user_info_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO users_info (id)
      VALUES (NEW.id);
      RETURN NEW;
    END;
    $$;


--
-- Name: delete_sales(integer[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_sales(sale_ids integer[], deleted_by_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  WITH cur_deleted_sales AS (
    DELETE FROM "sales"
    WHERE id = ANY(sale_ids)
    RETURNING *, deleted_by_id AS "deletedById"
  )
  INSERT INTO "deleted_sales" ("deletedById", "sale")
  SELECT "deletedById", row_to_json(cur_deleted_sales)
  FROM cur_deleted_sales;
END;
$$;


--
-- Name: gen_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gen_id() RETURNS text
    LANGUAGE plpgsql
    AS $$
 DECLARE
   chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
   result TEXT := '';
   i INTEGER := 0;
 BEGIN
   FOR i IN 1..7 LOOP
     result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
   END LOOP;
   RETURN result;
 END;
 $$;


--
-- Name: update_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW."updatedAt" = now(); 
  RETURN NEW;
END;
$$;


--
-- Name: users_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_seq
    START WITH 138
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer DEFAULT nextval('public.users_seq'::regclass) NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text DEFAULT ''::text,
    email text,
    phone text,
    role public."Role" NOT NULL,
    "gglName" text,
    "gglSub" text,
    picture text,
    suspended boolean DEFAULT false,
    name text GENERATED ALWAYS AS ((("firstName" || ' '::text) || "lastName")) STORED,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "tblPref" jsonb DEFAULT '{}'::jsonb,
    goals json,
    "favSaleIds" integer[] DEFAULT '{}'::integer[],
    "savedFilters" jsonb DEFAULT '[]'::jsonb,
    "favClientIds" integer[] DEFAULT ARRAY[]::integer[],
    otp jsonb,
    "createdById" integer,
    "idNum" text,
    "agencyId" integer NOT NULL,
    tfa jsonb,
    "sessionVersion" integer DEFAULT 0 NOT NULL,
    "emailVerifiedAt" timestamp with time zone,
    "facebookSub" text
);


--
-- Name: Agnt_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Agnt_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Agnt_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Agnt_id_seq" OWNED BY public.users.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id integer NOT NULL,
    name text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "agencyId" integer NOT NULL
);


--
-- Name: AgntsGroup_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."AgntsGroup_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: AgntsGroup_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."AgntsGroup_id_seq" OWNED BY public.teams.id;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id integer NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    "idNum" text,
    "createdById" integer NOT NULL,
    name text GENERATED ALWAYS AS ((("firstName" || ' '::text) || "lastName")) STORED,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "passportNum" character varying(255),
    "licenseNum" character varying(255),
    rank integer,
    status text DEFAULT true,
    "leadSource" text,
    email text,
    phone text,
    "secPhone" text,
    "birthDate" date,
    gender public.gender_enum,
    "familyId" integer,
    "handlerId" integer,
    "familyStatus" public.family_status_enum,
    "agencyId" integer NOT NULL,
    "userId" integer,
    lead boolean DEFAULT false,
    "idNumDate" date,
    "lastActivityAt" timestamp with time zone,
    "snoozeUntil" timestamp with time zone,
    "lastOutcomeType" character varying(255) DEFAULT NULL::character varying,
    "statusChangedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    details text GENERATED ALWAYS AS ((((COALESCE("firstName", ''::text) || ' '::text) || COALESCE("lastName", ''::text)) ||
CASE
    WHEN ("idNum" IS NOT NULL) THEN ((' ('::text || "idNum") || ')'::text)
    ELSE ''::text
END)) STORED,
    "overQuota" boolean DEFAULT false NOT NULL,
    "nextFollowUpAt" timestamp with time zone,
    "followUpNote" text,
    "createOrigin" text,
    CONSTRAINT clients_create_origin_check CHECK ((("createOrigin" IS NULL) OR ("createOrigin" = ANY (ARRAY['manual'::text, 'facebook'::text, 'whatsapp'::text, 'cf7'::text, 'import'::text]))))
);


--
-- Name: Client_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Client_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Client_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Client_id_seq" OWNED BY public.clients.id;


--
-- Name: cmsn_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cmsn_rules (
    id integer NOT NULL,
    branch text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    companies text[],
    "prdctTypes" text[],
    prdcts text[],
    "cmsnRate" double precision NOT NULL,
    "agencyId" integer NOT NULL
);


--
-- Name: CmsnRules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."CmsnRules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: CmsnRules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."CmsnRules_id_seq" OWNED BY public.cmsn_rules.id;


--
-- Name: deleted_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deleted_sales (
    id integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "deletedById" integer NOT NULL,
    sale jsonb NOT NULL
);


--
-- Name: DeletedSale_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."DeletedSale_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: DeletedSale_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."DeletedSale_id_seq" OWNED BY public.deleted_sales.id;


--
-- Name: promo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promo (
    id integer NOT NULL,
    title text NOT NULL,
    "desc" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "end" timestamp(3) without time zone NOT NULL,
    start timestamp(3) without time zone NOT NULL,
    goals json NOT NULL,
    "userIds" integer[],
    "grpIds" integer[],
    "isPromoGrp" boolean DEFAULT false,
    "promoGrps" jsonb,
    files integer[],
    img integer,
    "agencyId" integer NOT NULL
);


--
-- Name: Promo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Promo_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Promo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Promo_id_seq" OWNED BY public.promo.id;


--
-- Name: sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales (
    id integer NOT NULL,
    status text NOT NULL,
    action text DEFAULT 'מכירה'::text,
    company text NOT NULL,
    branch text NOT NULL,
    prdct text NOT NULL,
    "prdctType" text NOT NULL,
    "saleDt" timestamp(3) without time zone,
    "offrDt" timestamp(3) without time zone NOT NULL,
    "clientId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "createdById" integer NOT NULL,
    notes text,
    "otherAgnt" text,
    "favSalesId" integer,
    amount double precision NOT NULL,
    cmsn double precision DEFAULT 0,
    replace boolean DEFAULT false,
    "handlerId" integer,
    "leadSource" character varying(100),
    rwrd boolean DEFAULT false,
    tfuca numeric GENERATED ALWAYS AS (
CASE
    WHEN ("prdctType" ~~ '%חודשית%'::text) THEN (amount * (12)::double precision)
    ELSE amount
END) STORED,
    "agencyId" integer NOT NULL,
    "bizNum" text,
    "bizName" text
);


--
-- Name: Sale_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."Sale_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: Sale_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."Sale_id_seq" OWNED BY public.sales.id;


--
-- Name: sale_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sale_users (
    "saleId" integer NOT NULL,
    "userId" integer NOT NULL,
    prcnt real NOT NULL,
    amount real NOT NULL,
    cmsn real NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    tfuca real DEFAULT 0
);


--
-- Name: _flat_sales; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public._flat_sales AS
 SELECT su."userId",
    u.name,
    su.cmsn,
    s.branch,
    s."prdctType",
    su.amount,
    s.company,
    s.status,
    s."offrDt",
    s.action,
    s.prdct,
    s.replace,
    s."clientId",
    su.tfuca,
    s."agencyId",
    s."saleDt"
   FROM ((public.users u
     JOIN public.sale_users su ON ((u.id = su."userId")))
     JOIN public.sales s ON ((su."saleId" = s.id)));


--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations (
    id integer NOT NULL,
    filename character varying(255) NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: _migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._migrations_id_seq OWNED BY public._migrations.id;


--
-- Name: _sales; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public._sales AS
SELECT
    NULL::integer AS id,
    NULL::text AS status,
    NULL::text AS action,
    NULL::text AS company,
    NULL::text AS branch,
    NULL::text AS prdct,
    NULL::text AS "prdctType",
    NULL::timestamp(3) without time zone AS "saleDt",
    NULL::timestamp(3) without time zone AS "offrDt",
    NULL::integer AS "clientId",
    NULL::timestamp(3) without time zone AS "createdAt",
    NULL::timestamp(3) without time zone AS "updatedAt",
    NULL::integer AS "createdById",
    NULL::text AS notes,
    NULL::text AS "otherAgnt",
    NULL::integer AS "favSalesId",
    NULL::double precision AS amount,
    NULL::double precision AS cmsn,
    NULL::boolean AS replace,
    NULL::integer AS "handlerId",
    NULL::character varying(100) AS "leadSource",
    NULL::boolean AS rwrd,
    NULL::numeric AS tfuca,
    NULL::integer AS "agencyId",
    NULL::text AS "bizNum",
    NULL::text AS "bizName",
    NULL::boolean AS bonus,
    NULL::boolean AS "isUpgrade",
    NULL::text AS "clientData",
    NULL::text AS "handlerName",
    NULL::text AS "userName",
    NULL::integer[] AS "userIds",
    NULL::real[] AS "userPrcnts";


--
-- Name: _teams; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public._teams AS
SELECT
    NULL::integer AS id,
    NULL::text AS name,
    NULL::integer AS "agencyId",
    NULL::timestamp(3) without time zone AS "updatedAt",
    NULL::json AS users,
    NULL::json AS mngrs,
    NULL::json AS offices,
    NULL::integer[] AS "userIds",
    NULL::integer[] AS "mngrIds",
    NULL::integer[] AS "officeIds";


--
-- Name: agencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agencies (
    id integer NOT NULL,
    name text NOT NULL,
    img integer,
    pkg text,
    plan text DEFAULT 'free'::text NOT NULL,
    "planReason" text,
    "businessType" text,
    "taxId" text,
    address text,
    phone text,
    email text,
    country text DEFAULT 'IL'::text NOT NULL,
    "defaultCurrency" text DEFAULT 'ILS'::text NOT NULL,
    locale text DEFAULT 'he'::text NOT NULL,
    "docNumberFormat" text DEFAULT 'YYYY-NNNN'::text NOT NULL,
    "bankDetails" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "trialStartedAt" timestamp with time zone,
    "trialEndsAt" timestamp with time zone,
    "trialExempt" boolean DEFAULT false NOT NULL,
    "autoResponseEnabled" boolean DEFAULT false NOT NULL,
    "onboardingCompletedAt" timestamp with time zone,
    CONSTRAINT "agencies_businessType_check" CHECK (("businessType" = ANY (ARRAY['exempt'::text, 'authorized'::text, 'company'::text])))
);


--
-- Name: _trial_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public._trial_status AS
 SELECT id AS "agencyId",
    name AS "agencyName",
    plan,
    "trialExempt",
    "trialStartedAt",
    "trialEndsAt",
        CASE
            WHEN (plan = 'pro'::text) THEN 'PAID'::text
            WHEN "trialExempt" THEN 'LEGACY'::text
            WHEN (("trialStartedAt" IS NULL) OR ("trialEndsAt" IS NULL)) THEN 'NEVER_STARTED'::text
            WHEN (now() < "trialEndsAt") THEN 'TRIAL_ACTIVE'::text
            ELSE 'TRIAL_EXPIRED'::text
        END AS status,
        CASE
            WHEN ((plan = 'pro'::text) OR "trialExempt" OR ("trialStartedAt" IS NULL) OR ("trialEndsAt" IS NULL)) THEN NULL::integer
            ELSE (GREATEST((0)::numeric, ceil((EXTRACT(epoch FROM ("trialEndsAt" - now())) / (86400)::numeric))))::integer
        END AS "daysRemaining"
   FROM public.agencies a;


--
-- Name: agencies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agencies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agencies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agencies_id_seq OWNED BY public.agencies.id;


--
-- Name: ai_belief_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_belief_versions (
    id bigint NOT NULL,
    "beliefId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    version integer NOT NULL,
    content jsonb NOT NULL,
    confidence numeric(5,4) NOT NULL,
    groundedness numeric(5,4) NOT NULL,
    calibratable boolean NOT NULL,
    "uncertaintyKind" text NOT NULL,
    "evidenceFor" jsonb NOT NULL,
    "evidenceAgainst" jsonb NOT NULL,
    "isAbsenceDerived" boolean NOT NULL,
    "traceRefs" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "inferentialDistance" text NOT NULL,
    "freshnessAt" timestamp with time zone NOT NULL,
    "recordedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_belief_versions_version_check CHECK ((version >= 1))
);


--
-- Name: ai_belief_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_belief_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_belief_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_belief_versions_id_seq OWNED BY public.ai_belief_versions.id;


--
-- Name: ai_beliefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_beliefs (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "subjectType" text NOT NULL,
    "subjectId" text NOT NULL,
    key text NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence numeric(5,4) NOT NULL,
    groundedness numeric(5,4) NOT NULL,
    calibratable boolean DEFAULT true NOT NULL,
    "uncertaintyKind" text DEFAULT 'epistemic'::text NOT NULL,
    "evidenceFor" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "evidenceAgainst" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "isAbsenceDerived" boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "freshnessAt" timestamp with time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_beliefs_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT ai_beliefs_groundedness_check CHECK (((groundedness >= (0)::numeric) AND (groundedness <= (1)::numeric))),
    CONSTRAINT "ai_beliefs_subjectType_check" CHECK (("subjectType" = ANY (ARRAY['lead'::text, 'portfolio'::text]))),
    CONSTRAINT "ai_beliefs_uncertaintyKind_check" CHECK (("uncertaintyKind" = ANY (ARRAY['epistemic'::text, 'aleatoric'::text]))),
    CONSTRAINT ai_beliefs_version_check CHECK ((version >= 1))
);


--
-- Name: ai_beliefs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_beliefs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_beliefs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_beliefs_id_seq OWNED BY public.ai_beliefs.id;


--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversations (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "leadId" integer NOT NULL,
    "createdByUserId" integer NOT NULL,
    title text,
    state text DEFAULT 'active'::text NOT NULL,
    "lastMessageAt" timestamp with time zone,
    "messageCount" integer DEFAULT 0 NOT NULL,
    "summaryText" text,
    "summaryUpdatedAt" timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_conversations_state_check CHECK ((state = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: ai_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_conversations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_conversations_id_seq OWNED BY public.ai_conversations.id;


--
-- Name: ai_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_messages (
    id bigint NOT NULL,
    "conversationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "parentMessageId" bigint,
    role text NOT NULL,
    mode text,
    "taskKind" text,
    "actionId" text,
    status text DEFAULT 'complete'::text NOT NULL,
    text text DEFAULT ''::text NOT NULL,
    "structuredPayload" jsonb,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    lenses jsonb DEFAULT '[]'::jsonb NOT NULL,
    "errorReason" text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "completedAt" timestamp with time zone,
    sequence bigint NOT NULL,
    CONSTRAINT ai_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]))),
    CONSTRAINT ai_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'streaming'::text, 'complete'::text, 'failed'::text, 'aborted'::text])))
);


--
-- Name: ai_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_messages_id_seq OWNED BY public.ai_messages.id;


--
-- Name: ai_narrative_floor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_narrative_floor (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "subjectType" text NOT NULL,
    "subjectId" text NOT NULL,
    kind text NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    "occurredAt" timestamp with time zone NOT NULL,
    "recordedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_narrative_floor_kind_check CHECK ((kind = ANY (ARRAY['history'::text, 'promise'::text, 'outcome'::text]))),
    CONSTRAINT "ai_narrative_floor_subjectType_check" CHECK (("subjectType" = ANY (ARRAY['lead'::text, 'portfolio'::text])))
);


--
-- Name: ai_narrative_floor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_narrative_floor_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_narrative_floor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_narrative_floor_id_seq OWNED BY public.ai_narrative_floor.id;


--
-- Name: ai_provenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_provenance (
    id bigint NOT NULL,
    "beliefId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "traceRefs" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "inferencePath" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "inferentialDistance" text DEFAULT 'low'::text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "ai_provenance_inferentialDistance_check" CHECK (("inferentialDistance" = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: ai_provenance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_provenance_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_provenance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_provenance_id_seq OWNED BY public.ai_provenance.id;


--
-- Name: ai_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_runs (
    id bigint NOT NULL,
    "messageId" bigint,
    "conversationId" bigint,
    "agencyId" integer NOT NULL,
    "leadId" integer NOT NULL,
    "userId" integer,
    "taskKind" text NOT NULL,
    mode text,
    role text NOT NULL,
    provider text,
    model text,
    "chainIndex" smallint,
    "inputTokens" integer DEFAULT 0 NOT NULL,
    "outputTokens" integer DEFAULT 0 NOT NULL,
    "costUsd" numeric(10,6) DEFAULT 0 NOT NULL,
    "latencyMs" integer,
    success boolean NOT NULL,
    "errorCode" text,
    "errorMessage" text,
    "streamingState" text,
    "startedAt" timestamp with time zone NOT NULL,
    "endedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_runs_id_seq OWNED BY public.ai_runs.id;


--
-- Name: ai_shadow_coverage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_shadow_coverage (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "subjectType" text NOT NULL,
    "subjectId" text NOT NULL,
    reason text NOT NULL,
    outcome text NOT NULL,
    emitted boolean NOT NULL,
    "rejectionBoundary" text,
    decision jsonb NOT NULL,
    "sweptAt" timestamp with time zone NOT NULL,
    "sweepBucket" bigint NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_shadow_coverage_outcome_check CHECK ((outcome = ANY (ARRAY['recommend'::text, 'stay_silent'::text, 'rejected'::text]))),
    CONSTRAINT ai_shadow_coverage_reason_check CHECK ((reason = ANY (ARRAY['coverage_sweep'::text, 'staleness'::text]))),
    CONSTRAINT "ai_shadow_coverage_subjectType_check" CHECK (("subjectType" = ANY (ARRAY['lead'::text, 'portfolio'::text])))
);


--
-- Name: ai_shadow_coverage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_shadow_coverage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_shadow_coverage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_shadow_coverage_id_seq OWNED BY public.ai_shadow_coverage.id;


--
-- Name: ai_shadow_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_shadow_decisions (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "subjectType" text NOT NULL,
    "subjectId" text NOT NULL,
    "conversationId" bigint,
    "turnCount" integer,
    outcome text NOT NULL,
    emitted boolean NOT NULL,
    "rejectionBoundary" text,
    decision jsonb NOT NULL,
    "runtimeAsOf" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_shadow_decisions_outcome_check CHECK ((outcome = ANY (ARRAY['recommend'::text, 'stay_silent'::text, 'rejected'::text]))),
    CONSTRAINT "ai_shadow_decisions_subjectType_check" CHECK (("subjectType" = ANY (ARRAY['lead'::text, 'portfolio'::text])))
);


--
-- Name: ai_shadow_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_shadow_decisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_shadow_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_shadow_decisions_id_seq OWNED BY public.ai_shadow_decisions.id;


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "userId" integer,
    event text NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_events_id_seq OWNED BY public.analytics_events.id;


--
-- Name: auto_response_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_response_jobs (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "conversationId" bigint NOT NULL,
    "leadId" integer,
    channel text NOT NULL,
    reason text NOT NULL,
    "triggerSequence" integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "maxAttempts" integer DEFAULT 3 NOT NULL,
    "notBefore" timestamp with time zone DEFAULT now() NOT NULL,
    "lockedAt" timestamp with time zone,
    "lockedBy" text,
    "sentMessageId" bigint,
    "skipReason" text,
    "lastError" text,
    phase smallint DEFAULT 1 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auto_response_jobs_reason_check CHECK ((reason = ANY (ARRAY['first_contact'::text, 'qualify_turn'::text, 'no_response_warning'::text, 'no_response_close'::text]))),
    CONSTRAINT auto_response_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'skipped'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: auto_response_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_response_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_response_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_response_jobs_id_seq OWNED BY public.auto_response_jobs.id;


--
-- Name: auto_response_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_response_settings (
    "agencyId" integer NOT NULL,
    channel text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    "quietHours" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "dailyCap" integer DEFAULT 200 NOT NULL,
    guidance text,
    "updatedBy" integer,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    mode text DEFAULT 'acknowledge'::text NOT NULL,
    "maxTurns" integer DEFAULT 5 NOT NULL,
    "collectFields" jsonb DEFAULT '{"optional": ["budget", "location", "callback"], "required": ["name", "need", "urgency"]}'::jsonb NOT NULL,
    draft boolean DEFAULT false NOT NULL,
    "replyMode" text DEFAULT 'ai'::text NOT NULL,
    "fixedBody" text,
    "delaySeconds" integer DEFAULT 0 NOT NULL,
    CONSTRAINT auto_response_settings_mode_check CHECK ((mode = ANY (ARRAY['acknowledge'::text, 'qualify'::text])))
);


--
-- Name: automation_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_activity (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "automationId" integer NOT NULL,
    "leadId" integer NOT NULL,
    "leadName" text,
    kind text NOT NULL,
    mode text NOT NULL,
    "skipReason" text,
    subject text,
    "deliveryState" text,
    "providerMessageId" text,
    "contentSchemaVersion" integer,
    trigger text NOT NULL,
    origin text NOT NULL,
    "occurredAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "automation_activity_deliveryState_check" CHECK (("deliveryState" = ANY (ARRAY['sent'::text, 'delivered'::text, 'bounced'::text, 'failed'::text]))),
    CONSTRAINT automation_activity_kind_check CHECK ((kind = ANY (ARRAY['sent'::text, 'would_send'::text, 'skipped'::text, 'failed'::text]))),
    CONSTRAINT automation_activity_mode_check CHECK ((mode = ANY (ARRAY['live'::text, 'log'::text])))
);


--
-- Name: automation_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_activity_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_activity_id_seq OWNED BY public.automation_activity.id;


--
-- Name: automation_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_connections (
    id integer NOT NULL,
    "agencyId" integer NOT NULL,
    "integrationKey" text NOT NULL,
    "externalId" text,
    "displayName" text,
    "accessToken" text,
    "refreshToken" text,
    "webhookSecret" text,
    "expiresAt" timestamp with time zone,
    "revokedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "ownerUserId" integer,
    "lastEventAt" timestamp with time zone,
    "eventCount" integer DEFAULT 0 NOT NULL,
    "lastRejectedAt" timestamp with time zone,
    "consecutiveRejections" integer DEFAULT 0 NOT NULL,
    "lastRejectionReason" text
);


--
-- Name: automation_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_connections_id_seq OWNED BY public.automation_connections.id;


--
-- Name: automation_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_definitions (
    id integer NOT NULL,
    "agencyId" integer NOT NULL,
    name text NOT NULL,
    "recipeKey" text,
    status text DEFAULT 'draft'::text NOT NULL,
    trigger text NOT NULL,
    "targetStatus" text,
    "sourceFilter" text,
    action text DEFAULT 'send_email'::text NOT NULL,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdByUserId" integer NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "activatedAt" timestamp with time zone,
    "pausedAt" timestamp with time zone,
    "deletedAt" timestamp with time zone,
    conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    "connectionId" text,
    "sourceIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT automation_definitions_action_check CHECK ((action = ANY (ARRAY['send_email'::text, 'create_task'::text, 'send_whatsapp'::text, 'create_quote'::text]))),
    CONSTRAINT automation_definitions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'deleted'::text]))),
    CONSTRAINT automation_definitions_trigger_check CHECK ((trigger = ANY (ARRAY['lead_created'::text, 'status_changed'::text, 'appointment_booked'::text, 'form_submitted'::text])))
);


--
-- Name: automation_definitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_definitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_definitions_id_seq OWNED BY public.automation_definitions.id;


--
-- Name: automation_email_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_email_blocks (
    id integer NOT NULL,
    "agencyId" integer NOT NULL,
    "emailNormalized" text NOT NULL,
    reason text DEFAULT 'hard_bounce'::text NOT NULL,
    "blockedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_email_blocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_email_blocks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_email_blocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_email_blocks_id_seq OWNED BY public.automation_email_blocks.id;


--
-- Name: automation_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_jobs (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "automationId" integer NOT NULL,
    "leadId" integer NOT NULL,
    trigger text NOT NULL,
    origin text NOT NULL,
    "eventKey" text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "maxAttempts" integer DEFAULT 3 NOT NULL,
    "notBefore" timestamp with time zone DEFAULT now() NOT NULL,
    "lockedAt" timestamp with time zone,
    "lockedBy" text,
    "skipReason" text,
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_jobs_origin_check CHECK ((origin = ANY (ARRAY['webhook_facebook'::text, 'webhook_whatsapp'::text, 'webhook'::text, 'manual'::text, 'import'::text]))),
    CONSTRAINT automation_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'skipped'::text, 'failed'::text, 'dead'::text]))),
    CONSTRAINT automation_jobs_trigger_check CHECK ((trigger = ANY (ARRAY['lead_created'::text, 'status_changed'::text, 'appointment_booked'::text, 'form_submitted'::text])))
);


--
-- Name: automation_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_jobs_id_seq OWNED BY public.automation_jobs.id;


--
-- Name: automation_lead_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_lead_suppressions (
    id integer NOT NULL,
    "agencyId" integer NOT NULL,
    "leadId" integer NOT NULL,
    source text DEFAULT 'unsubscribe_link'::text NOT NULL,
    "unsubscribedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_lead_suppressions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_lead_suppressions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_lead_suppressions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_lead_suppressions_id_seq OWNED BY public.automation_lead_suppressions.id;


--
-- Name: automation_send_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_send_claims (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "automationId" integer NOT NULL,
    "leadId" integer NOT NULL,
    semantics text DEFAULT 'ever'::text NOT NULL,
    mode text NOT NULL,
    status text DEFAULT 'claimed'::text NOT NULL,
    "claimedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "confirmedAt" timestamp with time zone,
    CONSTRAINT automation_send_claims_mode_check CHECK ((mode = ANY (ARRAY['live'::text, 'log'::text]))),
    CONSTRAINT automation_send_claims_semantics_check CHECK ((semantics = 'ever'::text)),
    CONSTRAINT automation_send_claims_status_check CHECK ((status = ANY (ARRAY['claimed'::text, 'confirmed'::text])))
);


--
-- Name: automation_send_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_send_claims_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_send_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_send_claims_id_seq OWNED BY public.automation_send_claims.id;


--
-- Name: automation_source_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_source_labels (
    "agencyId" integer NOT NULL,
    "connectionId" text NOT NULL,
    "sourceId" text NOT NULL,
    label text NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_sources (
    id integer NOT NULL,
    "agencyId" integer NOT NULL,
    "connectionRowId" integer NOT NULL,
    "externalId" text NOT NULL,
    label text,
    subscription text DEFAULT 'pending'::text NOT NULL,
    "revokedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automation_sources_subscription_check CHECK ((subscription = ANY (ARRAY['subscribed'::text, 'pending'::text, 'failed'::text])))
);


--
-- Name: automation_sources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_sources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_sources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_sources_id_seq OWNED BY public.automation_sources.id;


--
-- Name: automation_template_installs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_template_installs (
    id integer NOT NULL,
    "agencyId" integer NOT NULL,
    "templateKey" text NOT NULL,
    "templateVersion" integer NOT NULL,
    "automationId" integer NOT NULL,
    "installedByUserId" integer,
    "installedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_template_installs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_template_installs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_template_installs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_template_installs_id_seq OWNED BY public.automation_template_installs.id;


--
-- Name: bill_billing_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_billing_profiles (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "leadId" integer NOT NULL,
    "createdByUserId" integer NOT NULL,
    "legalName" text NOT NULL,
    "taxId" text,
    address text,
    city text,
    zip text,
    country text DEFAULT 'IL'::text NOT NULL,
    email text,
    phone text,
    "defaultCurrency" text DEFAULT 'ILS'::text NOT NULL,
    locale text DEFAULT 'he'::text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bill_billing_profiles_state_check CHECK ((state = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: bill_billing_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_billing_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_billing_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_billing_profiles_id_seq OWNED BY public.bill_billing_profiles.id;


--
-- Name: bill_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_documents (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "invoiceId" bigint NOT NULL,
    kind text DEFAULT 'invoice_pdf'::text NOT NULL,
    locale text DEFAULT 'he'::text NOT NULL,
    "templateVersionId" smallint DEFAULT 1 NOT NULL,
    path text,
    url text,
    "contentHash" text,
    "byteSize" integer,
    status text DEFAULT 'rendering'::text NOT NULL,
    "errorReason" text,
    "isCurrent" boolean DEFAULT false NOT NULL,
    "renderedAt" timestamp with time zone,
    "renderedByUserId" integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bill_documents_kind_check CHECK ((kind = ANY (ARRAY['invoice_pdf'::text, 'receipt_pdf'::text, 'statement_pdf'::text]))),
    CONSTRAINT bill_documents_status_check CHECK ((status = ANY (ARRAY['rendering'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: bill_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_documents_id_seq OWNED BY public.bill_documents.id;


--
-- Name: bill_financial_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_financial_events (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "invoiceId" bigint,
    "leadId" integer,
    "actorUserId" integer,
    "actorKind" text NOT NULL,
    "eventType" text NOT NULL,
    "visibilityTier" text NOT NULL,
    "occurredAt" timestamp with time zone NOT NULL,
    "recordedAt" timestamp with time zone DEFAULT now() NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    "idempotencyKey" text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT "bill_financial_events_actorKind_check" CHECK (("actorKind" = ANY (ARRAY['user'::text, 'system'::text, 'webhook'::text, 'projection'::text]))),
    CONSTRAINT bill_financial_events_entity_required CHECK ((("invoiceId" IS NOT NULL) OR ("leadId" IS NOT NULL))),
    CONSTRAINT "bill_financial_events_visibilityTier_check" CHECK (("visibilityTier" = ANY (ARRAY['user'::text, 'system'::text, 'audit'::text])))
);


--
-- Name: bill_financial_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_financial_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_financial_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_financial_events_id_seq OWNED BY public.bill_financial_events.id;


--
-- Name: bill_invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_invoice_lines (
    id bigint NOT NULL,
    "invoiceId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "lineNumber" smallint NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    quantity numeric(10,4) DEFAULT 1 NOT NULL,
    "unitPrice" numeric(14,4) DEFAULT 0 NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    "taxRateId" bigint,
    "taxRatePercentSnapshot" numeric(7,4) DEFAULT 0 NOT NULL,
    "lineSubtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "lineTaxAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "lineTotal" numeric(14,2) DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bill_invoice_lines_discount_check CHECK ((discount >= (0)::numeric)),
    CONSTRAINT "bill_invoice_lines_lineNumber_check" CHECK (("lineNumber" >= 1)),
    CONSTRAINT bill_invoice_lines_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT "bill_invoice_lines_taxRatePercentSnapshot_check" CHECK (("taxRatePercentSnapshot" >= (0)::numeric))
);


--
-- Name: bill_invoice_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_invoice_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_invoice_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_invoice_lines_id_seq OWNED BY public.bill_invoice_lines.id;


--
-- Name: bill_invoice_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_invoice_versions (
    id bigint NOT NULL,
    "invoiceId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "versionNumber" smallint NOT NULL,
    "savedByUserId" integer NOT NULL,
    reason text DEFAULT 'autosave'::text NOT NULL,
    "snapshotPayload" jsonb NOT NULL,
    "savedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bill_invoice_versions_reason_check CHECK ((reason = ANY (ARRAY['autosave'::text, 'manual_save'::text, 'pre_issue'::text]))),
    CONSTRAINT "bill_invoice_versions_versionNumber_check" CHECK (("versionNumber" >= 1))
);


--
-- Name: bill_invoice_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_invoice_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_invoice_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_invoice_versions_id_seq OWNED BY public.bill_invoice_versions.id;


--
-- Name: bill_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_invoices (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "leadId" integer NOT NULL,
    "billingProfileId" bigint NOT NULL,
    "createdByUserId" integer NOT NULL,
    "docState" text DEFAULT 'draft'::text NOT NULL,
    "fulfillState" text,
    "documentNumber" bigint,
    "documentYear" smallint,
    "issuedAt" timestamp with time zone,
    "issuedByUserId" integer,
    "dueAt" date,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    currency text DEFAULT 'ILS'::text NOT NULL,
    locale text DEFAULT 'he'::text NOT NULL,
    "fxRate" numeric(16,8) DEFAULT 1.0 NOT NULL,
    "subtotalAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "taxAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "roundingAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "totalAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "legalNameSnapshot" text DEFAULT ''::text NOT NULL,
    "taxIdSnapshot" text DEFAULT ''::text NOT NULL,
    "addressSnapshot" text DEFAULT ''::text NOT NULL,
    "citySnapshot" text DEFAULT ''::text NOT NULL,
    "zipSnapshot" text DEFAULT ''::text NOT NULL,
    "countrySnapshot" text DEFAULT 'IL'::text NOT NULL,
    "emailSnapshot" text DEFAULT ''::text NOT NULL,
    "phoneSnapshot" text DEFAULT ''::text NOT NULL,
    "replacedByInvoiceId" bigint,
    "internalNotes" text DEFAULT ''::text NOT NULL,
    "customerFooter" text DEFAULT ''::text NOT NULL,
    "outstandingAmount" numeric(14,2),
    "lastEventAt" timestamp with time zone,
    "lastProjectionAt" timestamp with time zone,
    "lastViewedAt" timestamp with time zone,
    "reminderCount" integer DEFAULT 0 NOT NULL,
    "lastReminderAt" timestamp with time zone,
    "templateVersionId" smallint DEFAULT 1 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "issuerNameSnapshot" text DEFAULT ''::text NOT NULL,
    "issuerBusinessTypeSnapshot" text,
    "issuerTaxIdSnapshot" text DEFAULT ''::text NOT NULL,
    "issuerAddressSnapshot" text DEFAULT ''::text NOT NULL,
    "issuerPhoneSnapshot" text DEFAULT ''::text NOT NULL,
    "issuerEmailSnapshot" text DEFAULT ''::text NOT NULL,
    kind text DEFAULT 'invoice'::text NOT NULL,
    "paymentMethod" text,
    "paymentAmount" numeric(14,2),
    "paymentDate" date,
    "paymentReceived" boolean DEFAULT false NOT NULL,
    "paymentMethodSnapshot" text DEFAULT ''::text NOT NULL,
    "paymentAmountSnapshot" numeric(14,2),
    "paymentDateSnapshot" date,
    CONSTRAINT "bill_invoices_docState_check" CHECK (("docState" = ANY (ARRAY['draft'::text, 'issued'::text, 'voided'::text, 'replaced'::text]))),
    CONSTRAINT "bill_invoices_fulfillState_check" CHECK ((("fulfillState" IS NULL) OR ("fulfillState" = ANY (ARRAY['open'::text, 'partial'::text, 'paid'::text, 'overdue'::text, 'written_off'::text])))),
    CONSTRAINT bill_invoices_invoice_receipt_payment_invariants CHECK ((("docState" = 'draft'::text) OR (kind <> 'invoice_receipt'::text) OR (("paymentReceived" = true) AND ("paymentMethodSnapshot" <> ''::text) AND ("paymentAmountSnapshot" IS NOT NULL) AND ("paymentDateSnapshot" IS NOT NULL)))),
    CONSTRAINT "bill_invoices_issuerBusinessTypeSnapshot_check" CHECK ((("issuerBusinessTypeSnapshot" IS NULL) OR ("issuerBusinessTypeSnapshot" = ANY (ARRAY['exempt'::text, 'authorized'::text, 'company'::text])))),
    CONSTRAINT bill_invoices_kind_check CHECK ((kind = ANY (ARRAY['invoice'::text, 'invoice_receipt'::text]))),
    CONSTRAINT "bill_invoices_paymentMethod_check" CHECK ((("paymentMethod" IS NULL) OR ("paymentMethod" = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'check'::text, 'credit_card'::text, 'digital'::text, 'other'::text])))),
    CONSTRAINT bill_invoices_post_draft_invariants CHECK ((("docState" = 'draft'::text) OR (("documentNumber" IS NOT NULL) AND ("documentYear" IS NOT NULL) AND ("issuedAt" IS NOT NULL) AND ("issuedByUserId" IS NOT NULL) AND ("fulfillState" IS NOT NULL))))
);


--
-- Name: bill_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_invoices_id_seq OWNED BY public.bill_invoices.id;


--
-- Name: bill_numbering_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_numbering_sequences (
    "agencyId" integer NOT NULL,
    year smallint NOT NULL,
    kind text NOT NULL,
    "nextValue" bigint DEFAULT 1 NOT NULL,
    "lastIssuedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bill_numbering_sequences_kind_check CHECK ((kind = ANY (ARRAY['invoice'::text, 'receipt'::text]))),
    CONSTRAINT "bill_numbering_sequences_nextValue_check" CHECK (("nextValue" >= 1))
);


--
-- Name: bill_tax_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bill_tax_rates (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    "ratePercent" numeric(7,4) NOT NULL,
    country text DEFAULT 'IL'::text NOT NULL,
    "effectiveFrom" date NOT NULL,
    "effectiveTo" date,
    "createdByUserId" integer,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "bill_tax_rates_ratePercent_check" CHECK (("ratePercent" >= (0)::numeric))
);


--
-- Name: bill_tax_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bill_tax_rates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bill_tax_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bill_tax_rates_id_seq OWNED BY public.bill_tax_rates.id;


--
-- Name: client_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_lists (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    title text NOT NULL,
    "clientIds" integer[] DEFAULT '{}'::integer[] NOT NULL
);


--
-- Name: client_lists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_lists_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_lists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_lists_id_seq OWNED BY public.client_lists.id;


--
-- Name: clients_info; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients_info (
    id integer NOT NULL,
    "countryOfBirth" text,
    "isAmericanCitizen" boolean,
    "isGreenCard" boolean,
    city text,
    street text,
    "houseNum" text,
    zip text,
    job jsonb,
    "healthStatus" jsonb,
    heirs jsonb,
    "dangerousHobbies" text[],
    "generalGoals" text[],
    "savingGoals" text[],
    "insuranceGoals" text[],
    "idFiles" integer[],
    "ipuyFiles" jsonb DEFAULT '{}'::jsonb,
    "waitingIpuy" boolean
);


--
-- Name: clients_info_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clients_info_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clients_info_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clients_info_id_seq OWNED BY public.clients_info.id;


--
-- Name: contract_prdcts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_prdcts (
    id integer NOT NULL,
    "contractId" integer,
    branch character varying(100),
    prdcts character varying(100)[],
    "prdctTypes" character varying(100)[],
    companies character varying(100)[],
    prcnt double precision,
    "fromAmount" double precision DEFAULT '0'::double precision,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "tagmulType" public.tagmul_type_enum DEFAULT 'היקף'::public.tagmul_type_enum NOT NULL
);


--
-- Name: contract_prdcts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_prdcts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_prdcts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_prdcts_id_seq OWNED BY public.contract_prdcts.id;


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(50) NOT NULL,
    "mngrId" integer,
    "userIds" integer[],
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "agencyId" integer NOT NULL
);


--
-- Name: contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contracts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contracts_id_seq OWNED BY public.contracts.id;


--
-- Name: conversation_ai_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_ai_state (
    "conversationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "aiState" text DEFAULT 'new'::text NOT NULL,
    "aiTurnCount" integer DEFAULT 0 NOT NULL,
    "aiLastAt" timestamp with time zone,
    qualification jsonb DEFAULT '{}'::jsonb NOT NULL,
    "escalatedAt" timestamp with time zone,
    "escalationReason" text,
    "stoppedReason" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_ai_state_aistate_check CHECK (("aiState" = ANY (ARRAY['new'::text, 'ai_qualifying'::text, 'escalated'::text, 'dormant'::text, 'opted_out'::text, 'human_active'::text, 'closed'::text])))
);


--
-- Name: conversation_analysis_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_analysis_jobs (
    id bigint NOT NULL,
    "conversationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    reason text DEFAULT 'new_message'::text NOT NULL,
    "triggerSequence" bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "maxAttempts" integer DEFAULT 5 NOT NULL,
    "notBefore" timestamp with time zone DEFAULT now() NOT NULL,
    "lockedAt" timestamp with time zone,
    "lockedBy" text,
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_analysis_jobs_reason_check CHECK ((reason = ANY (ARRAY['new_message'::text, 'manual'::text, 'version_bump'::text, 'backfill'::text]))),
    CONSTRAINT conversation_analysis_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: conversation_analysis_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_analysis_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_analysis_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_analysis_jobs_id_seq OWNED BY public.conversation_analysis_jobs.id;


--
-- Name: conversation_intelligence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_intelligence (
    id bigint NOT NULL,
    "conversationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    kind text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'fresh'::text NOT NULL,
    "schemaVersion" integer DEFAULT 1 NOT NULL,
    "promptVersion" text,
    "analyzerVersion" text NOT NULL,
    "modelProvider" text,
    "modelId" text,
    "coveredSequence" bigint DEFAULT 0 NOT NULL,
    "inputHash" text,
    confidence text,
    "inputTokens" integer DEFAULT 0 NOT NULL,
    "outputTokens" integer DEFAULT 0 NOT NULL,
    "costUsd" numeric(12,6) DEFAULT 0 NOT NULL,
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_intelligence_status_check CHECK ((status = ANY (ARRAY['fresh'::text, 'stale'::text, 'failed'::text])))
);


--
-- Name: conversation_intelligence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_intelligence_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_intelligence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_intelligence_id_seq OWNED BY public.conversation_intelligence.id;


--
-- Name: conversation_intelligence_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_intelligence_runs (
    id bigint NOT NULL,
    "conversationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "jobId" bigint,
    kind text NOT NULL,
    success boolean NOT NULL,
    "analyzerVersion" text NOT NULL,
    "schemaVersion" integer DEFAULT 1 NOT NULL,
    "modelProvider" text,
    "modelId" text,
    "coveredSequence" bigint DEFAULT 0 NOT NULL,
    "inputHash" text,
    "inputTokens" integer DEFAULT 0 NOT NULL,
    "outputTokens" integer DEFAULT 0 NOT NULL,
    "costUsd" numeric(12,6) DEFAULT 0 NOT NULL,
    "latencyMs" integer,
    "errorReason" text,
    data jsonb,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_intelligence_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_intelligence_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_intelligence_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_intelligence_runs_id_seq OWNED BY public.conversation_intelligence_runs.id;


--
-- Name: default_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.default_settings (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    bronze text DEFAULT '300'::text,
    gold text DEFAULT '1000'::text,
    "achuzHafkadaPensia" text DEFAULT '10'::text,
    "achuzDmeiNihulKupatGemelTzvira" text DEFAULT '0.8'::text,
    "achuzDmeiNihulKupatGemelHafkada" text DEFAULT '0'::text,
    "achuzDmeiNihulKerenHishtalmutTzvira" text DEFAULT '0.8'::text,
    "achuzDmeiNihulKerenHishtalmutHafkada" text DEFAULT '0'::text,
    "achuzDmeiNihulPensiaTzvira" text DEFAULT '0.2'::text,
    "achuzDmeiNihulPensiaHafkada" text DEFAULT '2'::text,
    "achuzDmeiNihulMenahalimTzvira" text DEFAULT '0.6'::text,
    "monthsLoButzaPgishatSherutTkufatit" text DEFAULT '24'::text,
    "achuzKfitzatPremiaBitucheiPrat" text DEFAULT '10'::text,
    "monthsLidimSheloHufku" text DEFAULT '8'::text,
    "schumKerenHishtalmutHafkadaAtzmaiLeloHafkada" text DEFAULT '20520'::text,
    "achuzPensiaHafkadaAtzmaiLeloHafkada" text DEFAULT '16.5'::text,
    "isBituachHaimMutzarHaser" boolean DEFAULT false,
    "isBituachBriutMutzarHaser" boolean DEFAULT false,
    "isMahalotKashotMutzarHaser" boolean DEFAULT false,
    "isGemelLehashkaaMutzarHaser" boolean DEFAULT false,
    "monthsUpdated" text DEFAULT '24'::text,
    "isRiskUpdated" boolean DEFAULT false,
    "isMahalotKashotUpdated" boolean DEFAULT false
);


--
-- Name: default_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.default_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: default_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.default_settings_id_seq OWNED BY public.default_settings.id;


--
-- Name: email_automation_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_automation_sends (
    id bigint NOT NULL,
    "automationKey" text NOT NULL,
    "userId" integer NOT NULL,
    "agencyId" integer NOT NULL,
    "periodKey" text DEFAULT ''::text NOT NULL,
    status text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: email_automation_sends_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_automation_sends_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_automation_sends_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_automation_sends_id_seq OWNED BY public.email_automation_sends.id;


--
-- Name: email_suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_suppressions (
    id bigint NOT NULL,
    "userId" integer NOT NULL,
    scope text DEFAULT 'all'::text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: email_suppressions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_suppressions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_suppressions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_suppressions_id_seq OWNED BY public.email_suppressions.id;


--
-- Name: facebook_page_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facebook_page_comments (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "pageId" character varying(64) NOT NULL,
    "commentId" text NOT NULL,
    "postId" text NOT NULL,
    "parentId" text,
    "isTopLevel" boolean DEFAULT true NOT NULL,
    "authorExternalId" text,
    "authorName" text,
    message text DEFAULT ''::text NOT NULL,
    "messageAvailable" boolean DEFAULT false NOT NULL,
    verb text DEFAULT 'add'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    "convertedLeadId" integer,
    "createdTime" timestamp with time zone,
    "receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "deletedAt" timestamp with time zone,
    CONSTRAINT facebook_page_comments_status_check CHECK ((status = ANY (ARRAY['open'::text, 'converted'::text, 'ignored'::text, 'deleted'::text]))),
    CONSTRAINT facebook_page_comments_verb_check CHECK ((verb = ANY (ARRAY['add'::text, 'edited'::text])))
);


--
-- Name: facebook_page_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.facebook_page_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: facebook_page_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.facebook_page_comments_id_seq OWNED BY public.facebook_page_comments.id;


--
-- Name: facebook_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facebook_pages (
    id integer NOT NULL,
    user_id integer NOT NULL,
    agency_id integer NOT NULL,
    page_id character varying(64) NOT NULL,
    page_name character varying(255) NOT NULL,
    page_access_token text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    health_status character varying(255) DEFAULT 'unknown'::character varying NOT NULL,
    health_checked_at timestamp with time zone
);


--
-- Name: facebook_pages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.facebook_pages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: facebook_pages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.facebook_pages_id_seq OWNED BY public.facebook_pages.id;


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id integer NOT NULL,
    name text,
    type text,
    size text,
    path text,
    url character varying(255) GENERATED ALWAYS AS (('https://allin-storage.s3.il-central-1.amazonaws.com/'::text || path)) STORED,
    "createdById" integer,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "taskId" integer,
    "clientId" integer,
    "agencyId" integer NOT NULL,
    tags text[],
    polisa text
);


--
-- Name: files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.files_id_seq OWNED BY public.files.id;


--
-- Name: google_calendar_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_calendar_connections (
    id integer NOT NULL,
    user_id integer NOT NULL,
    agency_id integer NOT NULL,
    google_sub character varying(64) NOT NULL,
    google_email character varying(255) NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    scope text NOT NULL,
    primary_calendar_id character varying(255) DEFAULT 'primary'::character varying NOT NULL,
    sync_status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: google_calendar_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.google_calendar_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: google_calendar_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.google_calendar_connections_id_seq OWNED BY public.google_calendar_connections.id;


--
-- Name: google_drive_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_drive_connections (
    id integer NOT NULL,
    user_id integer NOT NULL,
    agency_id integer NOT NULL,
    google_sub character varying(64) NOT NULL,
    google_email character varying(255) NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    scope text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: google_drive_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.google_drive_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: google_drive_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.google_drive_connections_id_seq OWNED BY public.google_drive_connections.id;


--
-- Name: inbox_conversation_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_conversation_reads (
    id bigint NOT NULL,
    "conversationId" bigint NOT NULL,
    "userId" integer NOT NULL,
    "agencyId" integer NOT NULL,
    "lastReadAt" timestamp with time zone DEFAULT now() NOT NULL,
    "lastReadMessageId" bigint,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inbox_conversation_reads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_conversation_reads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_conversation_reads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_conversation_reads_id_seq OWNED BY public.inbox_conversation_reads.id;


--
-- Name: inbox_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_conversations (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "leadId" integer,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    "businessPhoneNumberId" text NOT NULL,
    "customerWaId" text NOT NULL,
    "customerName" text,
    state text DEFAULT 'open'::text NOT NULL,
    "lastMessageAt" timestamp with time zone,
    "lastInboundAt" timestamp with time zone,
    "lastDirection" text,
    "unreadCount" integer DEFAULT 0 NOT NULL,
    "messageCount" integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "lastMessageText" text,
    "isPersonal" boolean DEFAULT false NOT NULL,
    "personalMarkedByUserId" integer,
    "personalMarkedAt" timestamp with time zone,
    CONSTRAINT inbox_conversations_channel_check CHECK ((channel = 'whatsapp'::text)),
    CONSTRAINT inbox_conversations_state_check CHECK ((state = ANY (ARRAY['open'::text, 'archived'::text, 'closed'::text])))
);


--
-- Name: inbox_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_conversations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_conversations_id_seq OWNED BY public.inbox_conversations.id;


--
-- Name: inbox_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_messages (
    id bigint NOT NULL,
    "conversationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "leadId" integer,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    direction text NOT NULL,
    "externalId" text,
    "fromId" text,
    "toId" text,
    type text DEFAULT 'text'::text NOT NULL,
    text text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    "rawPayload" jsonb,
    status text DEFAULT 'received'::text NOT NULL,
    "errorReason" text,
    "sentByUserId" integer,
    "channelTimestamp" timestamp with time zone,
    sequence bigint NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbox_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
    CONSTRAINT inbox_messages_status_check CHECK ((status = ANY (ARRAY['received'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text]))),
    CONSTRAINT inbox_messages_type_check CHECK ((type = ANY (ARRAY['text'::text, 'image'::text, 'document'::text, 'audio'::text, 'video'::text, 'sticker'::text, 'location'::text, 'contacts'::text, 'interactive'::text, 'button'::text, 'reaction'::text, 'system'::text, 'unknown'::text])))
);


--
-- Name: inbox_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_messages_id_seq OWNED BY public.inbox_messages.id;


--
-- Name: inbox_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_participants (
    id bigint NOT NULL,
    "conversationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    role text NOT NULL,
    "waId" text NOT NULL,
    "displayName" text,
    "leadId" integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbox_participants_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'business'::text])))
);


--
-- Name: inbox_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_participants_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_participants_id_seq OWNED BY public.inbox_participants.id;


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id integer NOT NULL,
    email text NOT NULL,
    token text NOT NULL,
    role text NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    phone text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdById" integer NOT NULL,
    "agencyId" integer NOT NULL
);


--
-- Name: invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invitations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invitations_id_seq OWNED BY public.invitations.id;


--
-- Name: knex_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knex_migrations (
    id integer NOT NULL,
    name character varying(255),
    batch integer,
    migration_time timestamp with time zone
);


--
-- Name: knex_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knex_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knex_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knex_migrations_id_seq OWNED BY public.knex_migrations.id;


--
-- Name: knex_migrations_lock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knex_migrations_lock (
    index integer NOT NULL,
    is_locked integer
);


--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knex_migrations_lock_index_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knex_migrations_lock_index_seq OWNED BY public.knex_migrations_lock.index;


--
-- Name: lead_drive_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_drive_files (
    id integer NOT NULL,
    lead_id integer NOT NULL,
    agency_id integer NOT NULL,
    created_by_user_id integer NOT NULL,
    drive_file_id character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    mime_type character varying(255) NOT NULL,
    web_view_link text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: lead_drive_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_drive_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_drive_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_drive_files_id_seq OWNED BY public.lead_drive_files.id;


--
-- Name: meeting_attendees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_attendees (
    id integer NOT NULL,
    meeting_id integer NOT NULL,
    email character varying(255) NOT NULL,
    display_name character varying(255),
    user_id integer,
    lead_id integer,
    response_status character varying(32) DEFAULT 'needsAction'::character varying NOT NULL,
    is_organizer boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: meeting_attendees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meeting_attendees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meeting_attendees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meeting_attendees_id_seq OWNED BY public.meeting_attendees.id;


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id integer NOT NULL,
    agency_id integer NOT NULL,
    organizer_user_id integer NOT NULL,
    lead_id integer,
    title character varying(255) NOT NULL,
    description text,
    location character varying(255),
    timezone character varying(64) NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    status character varying(32) DEFAULT 'scheduled'::character varying NOT NULL,
    meet_url text,
    google_event_id character varying(1024),
    google_ical_uid character varying(1024),
    sync_status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    sync_attempts integer DEFAULT 0 NOT NULL,
    sync_error text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    internal_notes text,
    reminder_overrides jsonb,
    etag character varying(256),
    completed_at timestamp with time zone,
    no_show_at timestamp with time zone,
    last_refreshed_at timestamp with time zone
);


--
-- Name: meetings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meetings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meetings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meetings_id_seq OWNED BY public.meetings.id;


--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_deliveries (
    id bigint NOT NULL,
    "notificationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "userId" integer NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "failureReason" text,
    "suppressionReason" text,
    "groupedIntoDeliveryId" bigint,
    "providerMessageId" text,
    "queuedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "sentAt" timestamp with time zone,
    "deliveredAt" timestamp with time zone,
    "failedAt" timestamp with time zone,
    CONSTRAINT notification_deliveries_channel_check CHECK ((channel = ANY (ARRAY['in_app'::text, 'toast'::text, 'web_push'::text, 'email'::text]))),
    CONSTRAINT notification_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'suppressed'::text])))
);


--
-- Name: notification_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_deliveries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_deliveries_id_seq OWNED BY public.notification_deliveries.id;


--
-- Name: notification_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_jobs (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    type text NOT NULL,
    "eventKey" text NOT NULL,
    "actorUserId" integer,
    "entityType" text NOT NULL,
    "entityId" bigint NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "maxAttempts" integer DEFAULT 3 NOT NULL,
    "notBefore" timestamp with time zone DEFAULT now() NOT NULL,
    "lockedAt" timestamp with time zone,
    "lockedBy" text,
    "skipReason" text,
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'skipped'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: notification_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_jobs_id_seq OWNED BY public.notification_jobs.id;


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "userId" integer NOT NULL,
    category text NOT NULL,
    "inApp" boolean DEFAULT true NOT NULL,
    "webPush" boolean DEFAULT true NOT NULL,
    email boolean DEFAULT true NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_preferences_category_check CHECK ((category = ANY (ARRAY['leads'::text, 'messages'::text, 'followups'::text, 'sla'::text, 'integrations'::text])))
);


--
-- Name: notification_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_preferences_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_preferences_id_seq OWNED BY public.notification_preferences.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "userId" integer NOT NULL,
    type text NOT NULL,
    category text NOT NULL,
    priority text NOT NULL,
    title text NOT NULL,
    body text,
    "entityType" text,
    "entityId" bigint,
    "deepLink" text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "collapseKey" text NOT NULL,
    "groupCount" integer DEFAULT 1 NOT NULL,
    "escalationLevel" smallint DEFAULT 0 NOT NULL,
    "escalatedAt" timestamp with time zone,
    "seenAt" timestamp with time zone,
    "readAt" timestamp with time zone,
    "resolvedAt" timestamp with time zone,
    "resolvedReason" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['leads'::text, 'messages'::text, 'followups'::text, 'sla'::text, 'integrations'::text]))),
    CONSTRAINT notifications_priority_check CHECK ((priority = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text, 'info'::text]))),
    CONSTRAINT "notifications_resolvedReason_check" CHECK ((("resolvedReason" IS NULL) OR ("resolvedReason" = ANY (ARRAY['business_state'::text, 'superseded'::text, 'entity_gone'::text, 'manual'::text]))))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    "transactionId" text NOT NULL,
    "agencyId" integer NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: pending_upgrades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_upgrades (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    email character varying(255) NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "billingPeriod" text DEFAULT 'monthly'::text NOT NULL
);


--
-- Name: pending_upgrades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pending_upgrades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pending_upgrades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pending_upgrades_id_seq OWNED BY public.pending_upgrades.id;


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "userId" integer NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    "userAgent" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "lastUsedAt" timestamp with time zone,
    "failureCount" integer DEFAULT 0 NOT NULL
);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.push_subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;


--
-- Name: qualify_draft_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qualify_draft_review (
    id bigint NOT NULL,
    "conversationId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    decision text NOT NULL,
    "escalationReason" text,
    "replyText" text NOT NULL,
    extracted jsonb DEFAULT '{}'::jsonb NOT NULL,
    qualification jsonb DEFAULT '{}'::jsonb NOT NULL,
    "summaryText" text,
    "suggestedAction" text,
    temperature text,
    lang text,
    "turnCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: qualify_draft_review_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qualify_draft_review_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qualify_draft_review_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qualify_draft_review_id_seq OWNED BY public.qualify_draft_review.id;


--
-- Name: recovery_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recovery_alerts (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "leadId" integer NOT NULL,
    "conversationId" bigint,
    status text DEFAULT 'open'::text NOT NULL,
    "waitingMinutes" integer NOT NULL,
    "lastCustomerMessage" text,
    "lastCustomerMessageAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "resolvedAt" timestamp with time zone,
    CONSTRAINT recovery_alerts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);


--
-- Name: recovery_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recovery_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recovery_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recovery_alerts_id_seq OWNED BY public.recovery_alerts.id;


--
-- Name: sales_quote_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_quote_items (
    id bigint NOT NULL,
    "quoteId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "lineNumber" smallint NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    quantity numeric(10,4) DEFAULT 1 NOT NULL,
    "unitPrice" numeric(14,4) DEFAULT 0 NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    "taxRateId" bigint,
    "taxRatePercentSnapshot" numeric(7,4) DEFAULT 0 NOT NULL,
    "lineSubtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "lineTaxAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "lineTotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "isOptional" boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_quote_items_discount_check CHECK ((discount >= (0)::numeric)),
    CONSTRAINT "sales_quote_items_lineNumber_check" CHECK (("lineNumber" >= 1)),
    CONSTRAINT sales_quote_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT "sales_quote_items_taxRatePercentSnapshot_check" CHECK (("taxRatePercentSnapshot" >= (0)::numeric)),
    CONSTRAINT "sales_quote_items_unitPrice_check" CHECK (("unitPrice" >= (0)::numeric))
);


--
-- Name: sales_quote_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_quote_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_quote_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_quote_items_id_seq OWNED BY public.sales_quote_items.id;


--
-- Name: sales_quote_template_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_quote_template_items (
    id bigint NOT NULL,
    "templateId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "lineNumber" smallint NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    quantity numeric(10,4) DEFAULT 1 NOT NULL,
    "unitPrice" numeric(14,4) DEFAULT 0 NOT NULL,
    discount numeric(14,2) DEFAULT 0 NOT NULL,
    "isOptional" boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_quote_template_items_discount_check CHECK ((discount >= (0)::numeric)),
    CONSTRAINT "sales_quote_template_items_lineNumber_check" CHECK (("lineNumber" >= 1)),
    CONSTRAINT sales_quote_template_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT "sales_quote_template_items_unitPrice_check" CHECK (("unitPrice" >= (0)::numeric))
);


--
-- Name: sales_quote_template_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_quote_template_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_quote_template_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_quote_template_items_id_seq OWNED BY public.sales_quote_template_items.id;


--
-- Name: sales_quote_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_quote_templates (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "createdByUserId" integer NOT NULL,
    name text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    "introText" text DEFAULT ''::text NOT NULL,
    "termsText" text DEFAULT ''::text NOT NULL,
    currency text DEFAULT 'ILS'::text NOT NULL,
    locale text DEFAULT 'he'::text NOT NULL,
    "validityDays" smallint DEFAULT 14 NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_quote_templates_state_check CHECK ((state = ANY (ARRAY['active'::text, 'archived'::text]))),
    CONSTRAINT "sales_quote_templates_validityDays_check" CHECK ((("validityDays" >= 1) AND ("validityDays" <= 90)))
);


--
-- Name: sales_quote_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_quote_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_quote_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_quote_templates_id_seq OWNED BY public.sales_quote_templates.id;


--
-- Name: sales_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_quotes (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "leadId" integer NOT NULL,
    "createdByUserId" integer NOT NULL,
    "ownerUserId" integer,
    "templateId" bigint,
    status text DEFAULT 'draft'::text NOT NULL,
    "quoteNumber" bigint,
    "quoteYear" smallint,
    title text DEFAULT ''::text NOT NULL,
    currency text DEFAULT 'ILS'::text NOT NULL,
    locale text DEFAULT 'he'::text NOT NULL,
    "subtotalAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "taxAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "discountAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "totalAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "recipientNameSnapshot" text DEFAULT ''::text NOT NULL,
    "recipientEmailSnapshot" text DEFAULT ''::text NOT NULL,
    "recipientPhoneSnapshot" text DEFAULT ''::text NOT NULL,
    "introText" text DEFAULT ''::text NOT NULL,
    "termsText" text DEFAULT ''::text NOT NULL,
    "internalNotes" text DEFAULT ''::text NOT NULL,
    "expiresAt" date,
    "readyAt" timestamp with time zone,
    "sentAt" timestamp with time zone,
    "sentByUserId" integer,
    "decidedAt" timestamp with time zone,
    "declineReason" text,
    "convertedInvoiceId" bigint,
    "convertedAt" timestamp with time zone,
    "automationKey" text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_quotes_converted_requires_accept CHECK ((("convertedInvoiceId" IS NULL) OR (status = 'accepted'::text))),
    CONSTRAINT sales_quotes_decided_requires_timestamp CHECK (((status <> ALL (ARRAY['accepted'::text, 'declined'::text])) OR ("decidedAt" IS NOT NULL))),
    CONSTRAINT sales_quotes_post_draft_invariants CHECK (((status = 'draft'::text) OR (("quoteNumber" IS NOT NULL) AND ("quoteYear" IS NOT NULL) AND ("readyAt" IS NOT NULL)))),
    CONSTRAINT sales_quotes_sent_requires_timestamp CHECK (((status = ANY (ARRAY['draft'::text, 'ready'::text])) OR ("sentAt" IS NOT NULL))),
    CONSTRAINT sales_quotes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'ready'::text, 'sent'::text, 'accepted'::text, 'declined'::text, 'expired'::text])))
);


--
-- Name: sales_quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_quotes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_quotes_id_seq OWNED BY public.sales_quotes.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "planStartedAt" timestamp with time zone,
    "expiresAt" timestamp with time zone,
    "cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "billingPeriod" text DEFAULT 'monthly'::text NOT NULL,
    "growDirectDebitId" text
);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id bigint NOT NULL,
    "requestId" bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "authorKind" text NOT NULL,
    "authorUserId" integer,
    body text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "support_messages_authorKind_check" CHECK (("authorKind" = ANY (ARRAY['customer'::text, 'support'::text, 'system'::text]))),
    CONSTRAINT support_messages_body_present CHECK ((("authorKind" = 'customer'::text) OR (body ~ '[^[:space:]]'::text)))
);


--
-- Name: support_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_messages_id_seq OWNED BY public.support_messages.id;


--
-- Name: support_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_requests (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "createdByUserId" integer,
    "requesterNameSnapshot" text DEFAULT ''::text NOT NULL,
    "requesterEmailSnapshot" text DEFAULT ''::text NOT NULL,
    subject text NOT NULL,
    kind text NOT NULL,
    category text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    diagnostics jsonb DEFAULT '{}'::jsonb NOT NULL,
    "lastMessageAt" timestamp with time zone,
    "lastMessageAuthorKind" text,
    "resolvedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_requests_category_check CHECK ((category = ANY (ARRAY['leads'::text, 'whatsapp'::text, 'meta'::text, 'automations'::text, 'ai'::text, 'billing'::text, 'account'::text, 'integrations'::text, 'other'::text]))),
    CONSTRAINT support_requests_kind_check CHECK ((kind = ANY (ARRAY['question'::text, 'problem'::text]))),
    CONSTRAINT "support_requests_lastMessageAuthorKind_check" CHECK (("lastMessageAuthorKind" = ANY (ARRAY['customer'::text, 'support'::text, 'system'::text]))),
    CONSTRAINT support_requests_resolved_requires_timestamp CHECK (((status <> 'resolved'::text) OR ("resolvedAt" IS NOT NULL))),
    CONSTRAINT support_requests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'waiting_for_customer'::text, 'resolved'::text])))
);


--
-- Name: support_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_requests_id_seq OWNED BY public.support_requests.id;


--
-- Name: task_tmplts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_tmplts (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    tasks jsonb DEFAULT '[]'::jsonb,
    notes jsonb DEFAULT '{}'::jsonb,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    files integer[],
    "agencyId" integer NOT NULL
);


--
-- Name: task_tmplts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_tmplts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_tmplts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_tmplts_id_seq OWNED BY public.task_tmplts.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id integer NOT NULL,
    "clientId" integer NOT NULL,
    "userId" integer,
    title character varying(255) NOT NULL,
    status character varying(50),
    "tmpltId" integer,
    "dueDate" date,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed boolean DEFAULT false,
    tasks jsonb DEFAULT '[]'::jsonb,
    notes jsonb DEFAULT '[]'::jsonb,
    files integer[]
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: user_perms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_perms (
    "gotId" integer NOT NULL,
    "gaveId" integer NOT NULL
);


--
-- Name: user_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_presence (
    "userId" integer NOT NULL,
    "agencyId" integer NOT NULL,
    "lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
    "lastSeenVisible" boolean DEFAULT true NOT NULL,
    "awaySinceAt" timestamp with time zone,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_teams (
    "userId" integer NOT NULL,
    "teamId" integer NOT NULL,
    type text DEFAULT 'user'::text NOT NULL,
    CONSTRAINT user_teams_type_check CHECK ((type = ANY (ARRAY['user'::text, 'mngr'::text, 'office'::text])))
);


--
-- Name: users_info; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users_info (
    id integer NOT NULL,
    fax text,
    "officePhone" text,
    "agentLicenseNum" text,
    "logoutMinutes" integer DEFAULT 10,
    ips jsonb DEFAULT '{}'::jsonb,
    "tifulEmail" character varying(255),
    "agentLicenseFiles" integer[],
    "agentLicenseType" text,
    "agentLicenseName" text
);


--
-- Name: users_info_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_info_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_info_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_info_id_seq OWNED BY public.users_info.id;


--
-- Name: webhook_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_failures (
    id integer NOT NULL,
    lead_id character varying(255) NOT NULL,
    page_id character varying(255) NOT NULL,
    error_type character varying(255) NOT NULL,
    error_detail text,
    resolved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: webhook_failures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_failures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_failures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_failures_id_seq OWNED BY public.webhook_failures.id;


--
-- Name: whatsapp_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_connections (
    id integer NOT NULL,
    user_id integer NOT NULL,
    agency_id integer NOT NULL,
    phone_number_id character varying(64) NOT NULL,
    access_token text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    waba_id character varying(64),
    onboarding_type character varying(32)
);


--
-- Name: whatsapp_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_connections_id_seq OWNED BY public.whatsapp_connections.id;


--
-- Name: whatsapp_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_templates (
    id bigint NOT NULL,
    "agencyId" integer NOT NULL,
    "wabaId" character varying(64) NOT NULL,
    "metaTemplateId" character varying(64),
    name character varying(512) NOT NULL,
    "displayTitle" text NOT NULL,
    language character varying(16) DEFAULT 'he'::character varying NOT NULL,
    category character varying(24) NOT NULL,
    status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    "rejectionReason" character varying(64),
    "qualityRating" character varying(16),
    components jsonb DEFAULT '[]'::jsonb NOT NULL,
    "bodyText" text DEFAULT ''::text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb NOT NULL,
    "archivedAt" timestamp with time zone,
    "createdByUserId" integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whatsapp_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_templates_id_seq OWNED BY public.whatsapp_templates.id;


--
-- Name: _migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations ALTER COLUMN id SET DEFAULT nextval('public._migrations_id_seq'::regclass);


--
-- Name: agencies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies ALTER COLUMN id SET DEFAULT nextval('public.agencies_id_seq'::regclass);


--
-- Name: ai_belief_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_belief_versions ALTER COLUMN id SET DEFAULT nextval('public.ai_belief_versions_id_seq'::regclass);


--
-- Name: ai_beliefs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_beliefs ALTER COLUMN id SET DEFAULT nextval('public.ai_beliefs_id_seq'::regclass);


--
-- Name: ai_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations ALTER COLUMN id SET DEFAULT nextval('public.ai_conversations_id_seq'::regclass);


--
-- Name: ai_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_messages ALTER COLUMN id SET DEFAULT nextval('public.ai_messages_id_seq'::regclass);


--
-- Name: ai_narrative_floor id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_narrative_floor ALTER COLUMN id SET DEFAULT nextval('public.ai_narrative_floor_id_seq'::regclass);


--
-- Name: ai_provenance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provenance ALTER COLUMN id SET DEFAULT nextval('public.ai_provenance_id_seq'::regclass);


--
-- Name: ai_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_runs ALTER COLUMN id SET DEFAULT nextval('public.ai_runs_id_seq'::regclass);


--
-- Name: ai_shadow_coverage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_shadow_coverage ALTER COLUMN id SET DEFAULT nextval('public.ai_shadow_coverage_id_seq'::regclass);


--
-- Name: ai_shadow_decisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_shadow_decisions ALTER COLUMN id SET DEFAULT nextval('public.ai_shadow_decisions_id_seq'::regclass);


--
-- Name: analytics_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events ALTER COLUMN id SET DEFAULT nextval('public.analytics_events_id_seq'::regclass);


--
-- Name: auto_response_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_response_jobs ALTER COLUMN id SET DEFAULT nextval('public.auto_response_jobs_id_seq'::regclass);


--
-- Name: automation_activity id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_activity ALTER COLUMN id SET DEFAULT nextval('public.automation_activity_id_seq'::regclass);


--
-- Name: automation_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_connections ALTER COLUMN id SET DEFAULT nextval('public.automation_connections_id_seq'::regclass);


--
-- Name: automation_definitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_definitions ALTER COLUMN id SET DEFAULT nextval('public.automation_definitions_id_seq'::regclass);


--
-- Name: automation_email_blocks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_email_blocks ALTER COLUMN id SET DEFAULT nextval('public.automation_email_blocks_id_seq'::regclass);


--
-- Name: automation_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_jobs ALTER COLUMN id SET DEFAULT nextval('public.automation_jobs_id_seq'::regclass);


--
-- Name: automation_lead_suppressions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_lead_suppressions ALTER COLUMN id SET DEFAULT nextval('public.automation_lead_suppressions_id_seq'::regclass);


--
-- Name: automation_send_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_send_claims ALTER COLUMN id SET DEFAULT nextval('public.automation_send_claims_id_seq'::regclass);


--
-- Name: automation_sources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sources ALTER COLUMN id SET DEFAULT nextval('public.automation_sources_id_seq'::regclass);


--
-- Name: automation_template_installs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_template_installs ALTER COLUMN id SET DEFAULT nextval('public.automation_template_installs_id_seq'::regclass);


--
-- Name: bill_billing_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_billing_profiles ALTER COLUMN id SET DEFAULT nextval('public.bill_billing_profiles_id_seq'::regclass);


--
-- Name: bill_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_documents ALTER COLUMN id SET DEFAULT nextval('public.bill_documents_id_seq'::regclass);


--
-- Name: bill_financial_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_financial_events ALTER COLUMN id SET DEFAULT nextval('public.bill_financial_events_id_seq'::regclass);


--
-- Name: bill_invoice_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoice_lines ALTER COLUMN id SET DEFAULT nextval('public.bill_invoice_lines_id_seq'::regclass);


--
-- Name: bill_invoice_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoice_versions ALTER COLUMN id SET DEFAULT nextval('public.bill_invoice_versions_id_seq'::regclass);


--
-- Name: bill_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoices ALTER COLUMN id SET DEFAULT nextval('public.bill_invoices_id_seq'::regclass);


--
-- Name: bill_tax_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_tax_rates ALTER COLUMN id SET DEFAULT nextval('public.bill_tax_rates_id_seq'::regclass);


--
-- Name: client_lists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_lists ALTER COLUMN id SET DEFAULT nextval('public.client_lists_id_seq'::regclass);


--
-- Name: clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients ALTER COLUMN id SET DEFAULT nextval('public."Client_id_seq"'::regclass);


--
-- Name: clients_info id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients_info ALTER COLUMN id SET DEFAULT nextval('public.clients_info_id_seq'::regclass);


--
-- Name: cmsn_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmsn_rules ALTER COLUMN id SET DEFAULT nextval('public."CmsnRules_id_seq"'::regclass);


--
-- Name: contract_prdcts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_prdcts ALTER COLUMN id SET DEFAULT nextval('public.contract_prdcts_id_seq'::regclass);


--
-- Name: contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts ALTER COLUMN id SET DEFAULT nextval('public.contracts_id_seq'::regclass);


--
-- Name: conversation_analysis_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_analysis_jobs ALTER COLUMN id SET DEFAULT nextval('public.conversation_analysis_jobs_id_seq'::regclass);


--
-- Name: conversation_intelligence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_intelligence ALTER COLUMN id SET DEFAULT nextval('public.conversation_intelligence_id_seq'::regclass);


--
-- Name: conversation_intelligence_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_intelligence_runs ALTER COLUMN id SET DEFAULT nextval('public.conversation_intelligence_runs_id_seq'::regclass);


--
-- Name: default_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_settings ALTER COLUMN id SET DEFAULT nextval('public.default_settings_id_seq'::regclass);


--
-- Name: deleted_sales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_sales ALTER COLUMN id SET DEFAULT nextval('public."DeletedSale_id_seq"'::regclass);


--
-- Name: email_automation_sends id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_automation_sends ALTER COLUMN id SET DEFAULT nextval('public.email_automation_sends_id_seq'::regclass);


--
-- Name: email_suppressions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions ALTER COLUMN id SET DEFAULT nextval('public.email_suppressions_id_seq'::regclass);


--
-- Name: facebook_page_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook_page_comments ALTER COLUMN id SET DEFAULT nextval('public.facebook_page_comments_id_seq'::regclass);


--
-- Name: facebook_pages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook_pages ALTER COLUMN id SET DEFAULT nextval('public.facebook_pages_id_seq'::regclass);


--
-- Name: files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files ALTER COLUMN id SET DEFAULT nextval('public.files_id_seq'::regclass);


--
-- Name: google_calendar_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_connections ALTER COLUMN id SET DEFAULT nextval('public.google_calendar_connections_id_seq'::regclass);


--
-- Name: google_drive_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_drive_connections ALTER COLUMN id SET DEFAULT nextval('public.google_drive_connections_id_seq'::regclass);


--
-- Name: inbox_conversation_reads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_conversation_reads ALTER COLUMN id SET DEFAULT nextval('public.inbox_conversation_reads_id_seq'::regclass);


--
-- Name: inbox_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_conversations ALTER COLUMN id SET DEFAULT nextval('public.inbox_conversations_id_seq'::regclass);


--
-- Name: inbox_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages ALTER COLUMN id SET DEFAULT nextval('public.inbox_messages_id_seq'::regclass);


--
-- Name: inbox_participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_participants ALTER COLUMN id SET DEFAULT nextval('public.inbox_participants_id_seq'::regclass);


--
-- Name: invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations ALTER COLUMN id SET DEFAULT nextval('public.invitations_id_seq'::regclass);


--
-- Name: knex_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knex_migrations ALTER COLUMN id SET DEFAULT nextval('public.knex_migrations_id_seq'::regclass);


--
-- Name: knex_migrations_lock index; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knex_migrations_lock ALTER COLUMN index SET DEFAULT nextval('public.knex_migrations_lock_index_seq'::regclass);


--
-- Name: lead_drive_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_drive_files ALTER COLUMN id SET DEFAULT nextval('public.lead_drive_files_id_seq'::regclass);


--
-- Name: meeting_attendees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees ALTER COLUMN id SET DEFAULT nextval('public.meeting_attendees_id_seq'::regclass);


--
-- Name: meetings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings ALTER COLUMN id SET DEFAULT nextval('public.meetings_id_seq'::regclass);


--
-- Name: notification_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries ALTER COLUMN id SET DEFAULT nextval('public.notification_deliveries_id_seq'::regclass);


--
-- Name: notification_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_jobs ALTER COLUMN id SET DEFAULT nextval('public.notification_jobs_id_seq'::regclass);


--
-- Name: notification_preferences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences ALTER COLUMN id SET DEFAULT nextval('public.notification_preferences_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: pending_upgrades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_upgrades ALTER COLUMN id SET DEFAULT nextval('public.pending_upgrades_id_seq'::regclass);


--
-- Name: promo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo ALTER COLUMN id SET DEFAULT nextval('public."Promo_id_seq"'::regclass);


--
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);


--
-- Name: qualify_draft_review id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qualify_draft_review ALTER COLUMN id SET DEFAULT nextval('public.qualify_draft_review_id_seq'::regclass);


--
-- Name: recovery_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_alerts ALTER COLUMN id SET DEFAULT nextval('public.recovery_alerts_id_seq'::regclass);


--
-- Name: sales id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales ALTER COLUMN id SET DEFAULT nextval('public."Sale_id_seq"'::regclass);


--
-- Name: sales_quote_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_items ALTER COLUMN id SET DEFAULT nextval('public.sales_quote_items_id_seq'::regclass);


--
-- Name: sales_quote_template_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_template_items ALTER COLUMN id SET DEFAULT nextval('public.sales_quote_template_items_id_seq'::regclass);


--
-- Name: sales_quote_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_templates ALTER COLUMN id SET DEFAULT nextval('public.sales_quote_templates_id_seq'::regclass);


--
-- Name: sales_quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotes ALTER COLUMN id SET DEFAULT nextval('public.sales_quotes_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Name: support_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages ALTER COLUMN id SET DEFAULT nextval('public.support_messages_id_seq'::regclass);


--
-- Name: support_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_requests ALTER COLUMN id SET DEFAULT nextval('public.support_requests_id_seq'::regclass);


--
-- Name: task_tmplts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tmplts ALTER COLUMN id SET DEFAULT nextval('public.task_tmplts_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public."AgntsGroup_id_seq"'::regclass);


--
-- Name: users_info id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users_info ALTER COLUMN id SET DEFAULT nextval('public.users_info_id_seq'::regclass);


--
-- Name: webhook_failures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_failures ALTER COLUMN id SET DEFAULT nextval('public.webhook_failures_id_seq'::regclass);


--
-- Name: whatsapp_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_connections ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_connections_id_seq'::regclass);


--
-- Name: whatsapp_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_templates ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_templates_id_seq'::regclass);


--
-- Name: users Agnt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "Agnt_pkey" PRIMARY KEY (id);


--
-- Name: teams AgntsGroup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT "AgntsGroup_pkey" PRIMARY KEY (id);


--
-- Name: clients Client_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "Client_pkey" PRIMARY KEY (id);


--
-- Name: cmsn_rules CmsnRules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmsn_rules
    ADD CONSTRAINT "CmsnRules_pkey" PRIMARY KEY (id);


--
-- Name: deleted_sales DeletedSale_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_sales
    ADD CONSTRAINT "DeletedSale_pkey" PRIMARY KEY (id);


--
-- Name: promo Promo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo
    ADD CONSTRAINT "Promo_pkey" PRIMARY KEY (id);


--
-- Name: sales Sale_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT "Sale_pkey" PRIMARY KEY (id);


--
-- Name: _migrations _migrations_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_filename_key UNIQUE (filename);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (id);


--
-- Name: agencies agencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_pkey PRIMARY KEY (id);


--
-- Name: ai_belief_versions ai_belief_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_belief_versions
    ADD CONSTRAINT ai_belief_versions_pkey PRIMARY KEY (id);


--
-- Name: ai_beliefs ai_beliefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_beliefs
    ADD CONSTRAINT ai_beliefs_pkey PRIMARY KEY (id);


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);


--
-- Name: ai_messages ai_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_narrative_floor ai_narrative_floor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_narrative_floor
    ADD CONSTRAINT ai_narrative_floor_pkey PRIMARY KEY (id);


--
-- Name: ai_provenance ai_provenance_beliefId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provenance
    ADD CONSTRAINT "ai_provenance_beliefId_key" UNIQUE ("beliefId");


--
-- Name: ai_provenance ai_provenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provenance
    ADD CONSTRAINT ai_provenance_pkey PRIMARY KEY (id);


--
-- Name: ai_runs ai_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_runs
    ADD CONSTRAINT ai_runs_pkey PRIMARY KEY (id);


--
-- Name: ai_shadow_coverage ai_shadow_coverage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_shadow_coverage
    ADD CONSTRAINT ai_shadow_coverage_pkey PRIMARY KEY (id);


--
-- Name: ai_shadow_decisions ai_shadow_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_shadow_decisions
    ADD CONSTRAINT ai_shadow_decisions_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: auto_response_jobs auto_response_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_response_jobs
    ADD CONSTRAINT auto_response_jobs_pkey PRIMARY KEY (id);


--
-- Name: auto_response_settings auto_response_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_response_settings
    ADD CONSTRAINT auto_response_settings_pkey PRIMARY KEY ("agencyId", channel);


--
-- Name: automation_activity automation_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_activity
    ADD CONSTRAINT automation_activity_pkey PRIMARY KEY (id);


--
-- Name: automation_connections automation_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_connections
    ADD CONSTRAINT automation_connections_pkey PRIMARY KEY (id);


--
-- Name: automation_definitions automation_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_definitions
    ADD CONSTRAINT automation_definitions_pkey PRIMARY KEY (id);


--
-- Name: automation_email_blocks automation_email_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_email_blocks
    ADD CONSTRAINT automation_email_blocks_pkey PRIMARY KEY (id);


--
-- Name: automation_jobs automation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_jobs
    ADD CONSTRAINT automation_jobs_pkey PRIMARY KEY (id);


--
-- Name: automation_lead_suppressions automation_lead_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_lead_suppressions
    ADD CONSTRAINT automation_lead_suppressions_pkey PRIMARY KEY (id);


--
-- Name: automation_send_claims automation_send_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_send_claims
    ADD CONSTRAINT automation_send_claims_pkey PRIMARY KEY (id);


--
-- Name: automation_source_labels automation_source_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_source_labels
    ADD CONSTRAINT automation_source_labels_pkey PRIMARY KEY ("agencyId", "connectionId", "sourceId");


--
-- Name: automation_sources automation_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sources
    ADD CONSTRAINT automation_sources_pkey PRIMARY KEY (id);


--
-- Name: automation_template_installs automation_template_installs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_template_installs
    ADD CONSTRAINT automation_template_installs_pkey PRIMARY KEY (id);


--
-- Name: bill_billing_profiles bill_billing_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_billing_profiles
    ADD CONSTRAINT bill_billing_profiles_pkey PRIMARY KEY (id);


--
-- Name: bill_documents bill_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_documents
    ADD CONSTRAINT bill_documents_pkey PRIMARY KEY (id);


--
-- Name: bill_financial_events bill_financial_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_financial_events
    ADD CONSTRAINT bill_financial_events_pkey PRIMARY KEY (id);


--
-- Name: bill_invoice_lines bill_invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoice_lines
    ADD CONSTRAINT bill_invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: bill_invoice_versions bill_invoice_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoice_versions
    ADD CONSTRAINT bill_invoice_versions_pkey PRIMARY KEY (id);


--
-- Name: bill_invoices bill_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoices
    ADD CONSTRAINT bill_invoices_pkey PRIMARY KEY (id);


--
-- Name: bill_numbering_sequences bill_numbering_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_numbering_sequences
    ADD CONSTRAINT bill_numbering_sequences_pkey PRIMARY KEY ("agencyId", year, kind);


--
-- Name: bill_tax_rates bill_tax_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_tax_rates
    ADD CONSTRAINT bill_tax_rates_pkey PRIMARY KEY (id);


--
-- Name: client_lists client_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_lists
    ADD CONSTRAINT client_lists_pkey PRIMARY KEY (id);


--
-- Name: clients clients_idNum_agencyId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "clients_idNum_agencyId_unique" UNIQUE ("idNum", "agencyId");


--
-- Name: clients_info clients_info_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients_info
    ADD CONSTRAINT clients_info_pkey PRIMARY KEY (id);


--
-- Name: contract_prdcts contract_prdcts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_prdcts
    ADD CONSTRAINT contract_prdcts_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: conversation_ai_state conversation_ai_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_ai_state
    ADD CONSTRAINT conversation_ai_state_pkey PRIMARY KEY ("conversationId");


--
-- Name: conversation_analysis_jobs conversation_analysis_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_analysis_jobs
    ADD CONSTRAINT conversation_analysis_jobs_pkey PRIMARY KEY (id);


--
-- Name: conversation_intelligence conversation_intelligence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_intelligence
    ADD CONSTRAINT conversation_intelligence_pkey PRIMARY KEY (id);


--
-- Name: conversation_intelligence_runs conversation_intelligence_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_intelligence_runs
    ADD CONSTRAINT conversation_intelligence_runs_pkey PRIMARY KEY (id);


--
-- Name: default_settings default_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_settings
    ADD CONSTRAINT default_settings_pkey PRIMARY KEY (id);


--
-- Name: email_automation_sends email_automation_sends_automationkey_userid_periodkey_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_automation_sends
    ADD CONSTRAINT email_automation_sends_automationkey_userid_periodkey_unique UNIQUE ("automationKey", "userId", "periodKey");


--
-- Name: email_automation_sends email_automation_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_automation_sends
    ADD CONSTRAINT email_automation_sends_pkey PRIMARY KEY (id);


--
-- Name: email_suppressions email_suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_pkey PRIMARY KEY (id);


--
-- Name: email_suppressions email_suppressions_userid_scope_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_suppressions
    ADD CONSTRAINT email_suppressions_userid_scope_unique UNIQUE ("userId", scope);


--
-- Name: facebook_page_comments facebook_page_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook_page_comments
    ADD CONSTRAINT facebook_page_comments_pkey PRIMARY KEY (id);


--
-- Name: facebook_pages facebook_pages_page_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook_pages
    ADD CONSTRAINT facebook_pages_page_id_unique UNIQUE (page_id);


--
-- Name: facebook_pages facebook_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook_pages
    ADD CONSTRAINT facebook_pages_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: google_calendar_connections google_calendar_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_connections
    ADD CONSTRAINT google_calendar_connections_pkey PRIMARY KEY (id);


--
-- Name: google_calendar_connections google_calendar_connections_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_connections
    ADD CONSTRAINT google_calendar_connections_user_id_unique UNIQUE (user_id);


--
-- Name: google_drive_connections google_drive_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_drive_connections
    ADD CONSTRAINT google_drive_connections_pkey PRIMARY KEY (id);


--
-- Name: google_drive_connections google_drive_connections_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_drive_connections
    ADD CONSTRAINT google_drive_connections_user_id_unique UNIQUE (user_id);


--
-- Name: inbox_conversation_reads inbox_conversation_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_conversation_reads
    ADD CONSTRAINT inbox_conversation_reads_pkey PRIMARY KEY (id);


--
-- Name: inbox_conversations inbox_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_conversations
    ADD CONSTRAINT inbox_conversations_pkey PRIMARY KEY (id);


--
-- Name: inbox_messages inbox_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_pkey PRIMARY KEY (id);


--
-- Name: inbox_participants inbox_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_participants
    ADD CONSTRAINT inbox_participants_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: knex_migrations_lock knex_migrations_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knex_migrations_lock
    ADD CONSTRAINT knex_migrations_lock_pkey PRIMARY KEY (index);


--
-- Name: knex_migrations knex_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knex_migrations
    ADD CONSTRAINT knex_migrations_pkey PRIMARY KEY (id);


--
-- Name: lead_drive_files lead_drive_files_lead_file_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_drive_files
    ADD CONSTRAINT lead_drive_files_lead_file_unique UNIQUE (lead_id, drive_file_id);


--
-- Name: lead_drive_files lead_drive_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_drive_files
    ADD CONSTRAINT lead_drive_files_pkey PRIMARY KEY (id);


--
-- Name: meeting_attendees meeting_attendees_meeting_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_meeting_email_unique UNIQUE (meeting_id, email);


--
-- Name: meeting_attendees meeting_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);


--
-- Name: notification_jobs notification_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_jobs
    ADD CONSTRAINT notification_jobs_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_transactionId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_transactionId_key" UNIQUE ("transactionId");


--
-- Name: pending_upgrades pending_upgrades_agencyId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_upgrades
    ADD CONSTRAINT "pending_upgrades_agencyId_key" UNIQUE ("agencyId");


--
-- Name: pending_upgrades pending_upgrades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_upgrades
    ADD CONSTRAINT pending_upgrades_pkey PRIMARY KEY (id);


--
-- Name: promo promo_title_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo
    ADD CONSTRAINT promo_title_key UNIQUE (title);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: qualify_draft_review qualify_draft_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qualify_draft_review
    ADD CONSTRAINT qualify_draft_review_pkey PRIMARY KEY (id);


--
-- Name: recovery_alerts recovery_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_alerts
    ADD CONSTRAINT recovery_alerts_pkey PRIMARY KEY (id);


--
-- Name: sale_users sale_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_users
    ADD CONSTRAINT sale_users_pkey PRIMARY KEY ("saleId", "userId");


--
-- Name: sales_quote_items sales_quote_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_items
    ADD CONSTRAINT sales_quote_items_pkey PRIMARY KEY (id);


--
-- Name: sales_quote_template_items sales_quote_template_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_template_items
    ADD CONSTRAINT sales_quote_template_items_pkey PRIMARY KEY (id);


--
-- Name: sales_quote_templates sales_quote_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_templates
    ADD CONSTRAINT sales_quote_templates_pkey PRIMARY KEY (id);


--
-- Name: sales_quotes sales_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotes
    ADD CONSTRAINT sales_quotes_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_agencyId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_agencyId_key" UNIQUE ("agencyId");


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_requests support_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_requests
    ADD CONSTRAINT support_requests_pkey PRIMARY KEY (id);


--
-- Name: task_tmplts task_tmplts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tmplts
    ADD CONSTRAINT task_tmplts_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: user_perms user_perms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_perms
    ADD CONSTRAINT user_perms_pkey PRIMARY KEY ("gotId", "gaveId");


--
-- Name: user_presence user_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_presence
    ADD CONSTRAINT user_presence_pkey PRIMARY KEY ("userId");


--
-- Name: user_teams user_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_pkey PRIMARY KEY ("userId", "teamId");


--
-- Name: users users_firstName_lastName_agencyId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_firstName_lastName_agencyId_unique" UNIQUE ("firstName", "lastName", "agencyId");


--
-- Name: users_info users_info_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users_info
    ADD CONSTRAINT users_info_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_unique UNIQUE (phone);


--
-- Name: webhook_failures webhook_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_failures
    ADD CONSTRAINT webhook_failures_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_connections whatsapp_connections_phone_number_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_connections
    ADD CONSTRAINT whatsapp_connections_phone_number_id_unique UNIQUE (phone_number_id);


--
-- Name: whatsapp_connections whatsapp_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_connections
    ADD CONSTRAINT whatsapp_connections_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_templates whatsapp_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_templates
    ADD CONSTRAINT whatsapp_templates_pkey PRIMARY KEY (id);


--
-- Name: Agnt_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Agnt_email_idx" ON public.users USING btree (email);


--
-- Name: Agnt_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agnt_email_key" ON public.users USING btree (email);


--
-- Name: Agnt_phone_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Agnt_phone_key" ON public.users USING btree (phone);


--
-- Name: AgntsGroup_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "AgntsGroup_name_key" ON public.teams USING btree (name);


--
-- Name: ai_belief_versions_belief_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_belief_versions_belief_recent_idx ON public.ai_belief_versions USING btree ("beliefId", version DESC);


--
-- Name: ai_belief_versions_belief_version_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_belief_versions_belief_version_uniq ON public.ai_belief_versions USING btree ("beliefId", version);


--
-- Name: ai_beliefs_freshness_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_beliefs_freshness_idx ON public.ai_beliefs USING btree ("agencyId", "freshnessAt");


--
-- Name: ai_beliefs_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_beliefs_subject_idx ON public.ai_beliefs USING btree ("agencyId", "subjectType", "subjectId");


--
-- Name: ai_beliefs_subject_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_beliefs_subject_key_uniq ON public.ai_beliefs USING btree ("agencyId", "subjectType", "subjectId", key);


--
-- Name: ai_conversations_active_default_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_conversations_active_default_uniq ON public.ai_conversations USING btree ("agencyId", "leadId") WHERE (state = 'active'::text);


--
-- Name: ai_conversations_lead_lastmsg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_conversations_lead_lastmsg_idx ON public.ai_conversations USING btree ("agencyId", "leadId", state, "lastMessageAt" DESC);


--
-- Name: ai_conversations_user_lastmsg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_conversations_user_lastmsg_idx ON public.ai_conversations USING btree ("agencyId", "createdByUserId", "lastMessageAt" DESC);


--
-- Name: ai_messages_conv_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_messages_conv_created_idx ON public.ai_messages USING btree ("conversationId", "createdAt" DESC);


--
-- Name: ai_messages_conv_seq_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_messages_conv_seq_uniq ON public.ai_messages USING btree ("conversationId", sequence);


--
-- Name: ai_messages_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_messages_parent_idx ON public.ai_messages USING btree ("parentMessageId") WHERE ("parentMessageId" IS NOT NULL);


--
-- Name: ai_narrative_floor_subject_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_narrative_floor_subject_time_idx ON public.ai_narrative_floor USING btree ("agencyId", "subjectType", "subjectId", "occurredAt");


--
-- Name: ai_provenance_agency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_provenance_agency_idx ON public.ai_provenance USING btree ("agencyId");


--
-- Name: ai_runs_agency_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_runs_agency_created_idx ON public.ai_runs USING btree ("agencyId", "createdAt" DESC);


--
-- Name: ai_runs_agency_success_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_runs_agency_success_created_idx ON public.ai_runs USING btree ("agencyId", success, "createdAt" DESC);


--
-- Name: ai_runs_agency_task_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_runs_agency_task_created_idx ON public.ai_runs USING btree ("agencyId", "taskKind", "createdAt" DESC);


--
-- Name: ai_runs_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_runs_message_idx ON public.ai_runs USING btree ("messageId") WHERE ("messageId" IS NOT NULL);


--
-- Name: ai_shadow_coverage_obs_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_shadow_coverage_obs_uniq ON public.ai_shadow_coverage USING btree ("agencyId", "subjectType", "subjectId", "sweepBucket", reason);


--
-- Name: ai_shadow_coverage_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_shadow_coverage_subject_idx ON public.ai_shadow_coverage USING btree ("agencyId", "subjectType", "subjectId");


--
-- Name: ai_shadow_decisions_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_shadow_decisions_subject_idx ON public.ai_shadow_decisions USING btree ("agencyId", "subjectType", "subjectId");


--
-- Name: ai_shadow_decisions_turn_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_shadow_decisions_turn_uniq ON public.ai_shadow_decisions USING btree ("agencyId", "conversationId", "turnCount");


--
-- Name: analytics_events_once_per_agency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX analytics_events_once_per_agency ON public.analytics_events USING btree ("agencyId", event) WHERE (event = ANY (ARRAY['registration_completed'::text, 'desktop_first_access'::text, 'welcome_modal_shown'::text, 'trial_started'::text, 'trial_expired'::text]));


--
-- Name: auto_response_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auto_response_jobs_claim_idx ON public.auto_response_jobs USING btree (status, "notBefore");


--
-- Name: auto_response_jobs_conv_reason_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auto_response_jobs_conv_reason_status_idx ON public.auto_response_jobs USING btree ("conversationId", reason, status);


--
-- Name: auto_response_jobs_inflight_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auto_response_jobs_inflight_uniq ON public.auto_response_jobs USING btree ("conversationId") WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: automation_activity_agency_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_activity_agency_time_idx ON public.automation_activity USING btree ("agencyId", "occurredAt");


--
-- Name: automation_activity_automation_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_activity_automation_time_idx ON public.automation_activity USING btree ("automationId", "occurredAt");


--
-- Name: automation_activity_lead_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_activity_lead_time_idx ON public.automation_activity USING btree ("agencyId", "leadId", "occurredAt");


--
-- Name: automation_activity_provider_msg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_activity_provider_msg_idx ON public.automation_activity USING btree ("providerMessageId") WHERE ("providerMessageId" IS NOT NULL);


--
-- Name: automation_connections_agency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_connections_agency_idx ON public.automation_connections USING btree ("agencyId", "integrationKey");


--
-- Name: automation_connections_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_connections_identity_idx ON public.automation_connections USING btree ("agencyId", "integrationKey", "externalId");


--
-- Name: automation_connections_rejecting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_connections_rejecting_idx ON public.automation_connections USING btree ("agencyId") WHERE ("consecutiveRejections" > 0);


--
-- Name: automation_definitions_active_trigger_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_definitions_active_trigger_idx ON public.automation_definitions USING btree ("agencyId", trigger) WHERE (status = 'active'::text);


--
-- Name: automation_definitions_agency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_definitions_agency_idx ON public.automation_definitions USING btree ("agencyId");


--
-- Name: automation_email_blocks_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_email_blocks_uniq ON public.automation_email_blocks USING btree ("agencyId", "emailNormalized");


--
-- Name: automation_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_jobs_claim_idx ON public.automation_jobs USING btree ("notBefore") WHERE (status = 'pending'::text);


--
-- Name: automation_jobs_dedup_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_jobs_dedup_uniq ON public.automation_jobs USING btree ("automationId", "leadId", "eventKey");


--
-- Name: automation_lead_suppressions_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_lead_suppressions_uniq ON public.automation_lead_suppressions USING btree ("agencyId", "leadId");


--
-- Name: automation_send_claims_once_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_send_claims_once_uniq ON public.automation_send_claims USING btree ("automationId", "leadId", semantics);


--
-- Name: automation_sources_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_sources_identity_idx ON public.automation_sources USING btree ("connectionRowId", "externalId");


--
-- Name: automation_template_installs_agency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX automation_template_installs_agency_idx ON public.automation_template_installs USING btree ("agencyId", "templateKey");


--
-- Name: automation_template_installs_automation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX automation_template_installs_automation_idx ON public.automation_template_installs USING btree ("automationId");


--
-- Name: bill_billing_profiles_active_per_lead_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_billing_profiles_active_per_lead_uniq ON public.bill_billing_profiles USING btree ("agencyId", "leadId") WHERE (state = 'active'::text);


--
-- Name: bill_billing_profiles_agency_lead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_billing_profiles_agency_lead_idx ON public.bill_billing_profiles USING btree ("agencyId", "leadId");


--
-- Name: bill_documents_agency_invoice_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_documents_agency_invoice_created_idx ON public.bill_documents USING btree ("agencyId", "invoiceId", "createdAt" DESC);


--
-- Name: bill_documents_invoice_current_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_documents_invoice_current_uniq ON public.bill_documents USING btree ("invoiceId") WHERE ("isCurrent" = true);


--
-- Name: bill_documents_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_documents_pending_idx ON public.bill_documents USING btree ("agencyId", "createdAt") WHERE (status = 'rendering'::text);


--
-- Name: bill_financial_events_agency_idempotency_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_financial_events_agency_idempotency_uniq ON public.bill_financial_events USING btree ("agencyId", "idempotencyKey") WHERE ("idempotencyKey" IS NOT NULL);


--
-- Name: bill_financial_events_agency_invoice_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_financial_events_agency_invoice_occurred_idx ON public.bill_financial_events USING btree ("agencyId", "invoiceId", "occurredAt" DESC) WHERE ("invoiceId" IS NOT NULL);


--
-- Name: bill_financial_events_agency_lead_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_financial_events_agency_lead_occurred_idx ON public.bill_financial_events USING btree ("agencyId", "leadId", "occurredAt" DESC) WHERE ("leadId" IS NOT NULL);


--
-- Name: bill_invoice_lines_invoice_line_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_invoice_lines_invoice_line_uniq ON public.bill_invoice_lines USING btree ("invoiceId", "lineNumber");


--
-- Name: bill_invoice_versions_invoice_version_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_invoice_versions_invoice_version_uniq ON public.bill_invoice_versions USING btree ("invoiceId", "versionNumber");


--
-- Name: bill_invoices_agency_docstate_dueat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_invoices_agency_docstate_dueat_idx ON public.bill_invoices USING btree ("agencyId", "docState", "dueAt");


--
-- Name: bill_invoices_agency_issued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_invoices_agency_issued_idx ON public.bill_invoices USING btree ("agencyId", "issuedAt" DESC) WHERE ("docState" <> 'draft'::text);


--
-- Name: bill_invoices_agency_lead_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_invoices_agency_lead_created_idx ON public.bill_invoices USING btree ("agencyId", "leadId", "createdAt" DESC);


--
-- Name: bill_invoices_agency_year_number_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_invoices_agency_year_number_uniq ON public.bill_invoices USING btree ("agencyId", "documentYear", "documentNumber") WHERE ("docState" <> 'draft'::text);


--
-- Name: bill_tax_rates_agency_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bill_tax_rates_agency_active_idx ON public.bill_tax_rates USING btree ("agencyId", "effectiveTo");


--
-- Name: bill_tax_rates_agency_code_from_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bill_tax_rates_agency_code_from_uniq ON public.bill_tax_rates USING btree ("agencyId", code, "effectiveFrom");


--
-- Name: clients_agency_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX clients_agency_email_unique ON public.clients USING btree ("agencyId", email) WHERE (email IS NOT NULL);


--
-- Name: clients_agency_next_followup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_agency_next_followup_idx ON public.clients USING btree ("agencyId", "nextFollowUpAt") WHERE ("nextFollowUpAt" IS NOT NULL);


--
-- Name: clients_agency_phone_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX clients_agency_phone_unique ON public.clients USING btree ("agencyId", phone) WHERE (phone IS NOT NULL);


--
-- Name: clients_lead_source_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX clients_lead_source_unique ON public.clients USING btree ("leadSource") WHERE ("leadSource" IS NOT NULL);


--
-- Name: clients_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_name_trgm_idx ON public.clients USING gin (name public.gin_trgm_ops);


--
-- Name: conversation_ai_state_agency_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_ai_state_agency_state_idx ON public.conversation_ai_state USING btree ("agencyId", "aiState");


--
-- Name: conversation_analysis_jobs_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_analysis_jobs_due_idx ON public.conversation_analysis_jobs USING btree (status, "notBefore");


--
-- Name: conversation_analysis_jobs_locked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_analysis_jobs_locked_idx ON public.conversation_analysis_jobs USING btree (status, "lockedAt");


--
-- Name: conversation_analysis_jobs_pending_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversation_analysis_jobs_pending_uniq ON public.conversation_analysis_jobs USING btree ("conversationId") WHERE (status = 'pending'::text);


--
-- Name: conversation_intelligence_action_value_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_intelligence_action_value_idx ON public.conversation_intelligence USING btree ("agencyId", ((data ->> 'suggestedAction'::text))) WHERE (kind = 'suggested_action'::text);


--
-- Name: conversation_intelligence_agency_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_intelligence_agency_conv_idx ON public.conversation_intelligence USING btree ("agencyId", "conversationId");


--
-- Name: conversation_intelligence_conv_kind_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversation_intelligence_conv_kind_uniq ON public.conversation_intelligence USING btree ("conversationId", kind);


--
-- Name: conversation_intelligence_intent_value_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_intelligence_intent_value_idx ON public.conversation_intelligence USING btree ("agencyId", ((data ->> 'intent'::text))) WHERE (kind = 'intent'::text);


--
-- Name: conversation_intelligence_runs_conv_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_intelligence_runs_conv_created_idx ON public.conversation_intelligence_runs USING btree ("conversationId", "createdAt" DESC);


--
-- Name: conversation_intelligence_temperature_value_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_intelligence_temperature_value_idx ON public.conversation_intelligence USING btree ("agencyId", ((data ->> 'temperature'::text))) WHERE (kind = 'temperature'::text);


--
-- Name: email_automation_sends_automationkey_createdat_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_automation_sends_automationkey_createdat_index ON public.email_automation_sends USING btree ("automationKey", "createdAt");


--
-- Name: facebook_page_comments_agency_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facebook_page_comments_agency_status_idx ON public.facebook_page_comments USING btree ("agencyId", status, "createdTime" DESC);


--
-- Name: facebook_page_comments_lead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facebook_page_comments_lead_idx ON public.facebook_page_comments USING btree ("convertedLeadId");


--
-- Name: facebook_page_comments_page_comment_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX facebook_page_comments_page_comment_uniq ON public.facebook_page_comments USING btree ("pageId", "commentId");


--
-- Name: facebook_pages_page_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facebook_pages_page_id_idx ON public.facebook_pages USING btree (page_id);


--
-- Name: facebook_pages_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facebook_pages_user_id_idx ON public.facebook_pages USING btree (user_id);


--
-- Name: google_calendar_connections_agency_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX google_calendar_connections_agency_id_idx ON public.google_calendar_connections USING btree (agency_id);


--
-- Name: google_drive_connections_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX google_drive_connections_user_id_idx ON public.google_drive_connections USING btree (user_id);


--
-- Name: idx_sale_users_sale_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sale_users_sale_id ON public.sale_users USING btree ("saleId");


--
-- Name: idx_sale_users_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sale_users_user_id ON public.sale_users USING btree ("userId");


--
-- Name: idx_sales_agency_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_agency_date ON public.sales USING btree ("agencyId", "offrDt");


--
-- Name: idx_sales_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_client_id ON public.sales USING btree ("clientId");


--
-- Name: idx_sales_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_updated_at ON public.sales USING btree ("updatedAt");


--
-- Name: idx_users_agency_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_agency_id ON public.users USING btree ("agencyId");


--
-- Name: inbox_conversation_reads_agency_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_conversation_reads_agency_user_idx ON public.inbox_conversation_reads USING btree ("agencyId", "userId");


--
-- Name: inbox_conversation_reads_conv_user_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_conversation_reads_conv_user_uniq ON public.inbox_conversation_reads USING btree ("conversationId", "userId");


--
-- Name: inbox_conversations_agency_lastmsg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_conversations_agency_lastmsg_idx ON public.inbox_conversations USING btree ("agencyId", "lastMessageAt" DESC, id DESC);


--
-- Name: inbox_conversations_agency_state_lastmsg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_conversations_agency_state_lastmsg_idx ON public.inbox_conversations USING btree ("agencyId", state, "lastMessageAt" DESC, id DESC);


--
-- Name: inbox_conversations_customerwaid_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_conversations_customerwaid_trgm_idx ON public.inbox_conversations USING gin ("customerWaId" public.gin_trgm_ops);


--
-- Name: inbox_conversations_lastmsgtext_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_conversations_lastmsgtext_trgm_idx ON public.inbox_conversations USING gin ("lastMessageText" public.gin_trgm_ops);


--
-- Name: inbox_conversations_lead_lastmsg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_conversations_lead_lastmsg_idx ON public.inbox_conversations USING btree ("agencyId", "leadId", "lastMessageAt" DESC);


--
-- Name: inbox_conversations_thread_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_conversations_thread_uniq ON public.inbox_conversations USING btree (channel, "businessPhoneNumberId", "customerWaId");


--
-- Name: inbox_messages_channel_external_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_messages_channel_external_uniq ON public.inbox_messages USING btree (channel, "externalId");


--
-- Name: inbox_messages_conv_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_conv_created_idx ON public.inbox_messages USING btree ("conversationId", "createdAt" DESC);


--
-- Name: inbox_messages_conv_seq_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_messages_conv_seq_uniq ON public.inbox_messages USING btree ("conversationId", sequence);


--
-- Name: inbox_participants_conv_role_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_participants_conv_role_uniq ON public.inbox_participants USING btree ("conversationId", role);


--
-- Name: lead_drive_files_lead_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_drive_files_lead_id_idx ON public.lead_drive_files USING btree (lead_id);


--
-- Name: meeting_attendees_meeting_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_attendees_meeting_id_idx ON public.meeting_attendees USING btree (meeting_id);


--
-- Name: meetings_agency_organizer_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meetings_agency_organizer_start_idx ON public.meetings USING btree (agency_id, organizer_user_id, start_at);


--
-- Name: meetings_lead_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meetings_lead_id_idx ON public.meetings USING btree (lead_id);


--
-- Name: meetings_sync_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meetings_sync_status_idx ON public.meetings USING btree (sync_status);


--
-- Name: notification_deliveries_notification_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_deliveries_notification_idx ON public.notification_deliveries USING btree ("notificationId");


--
-- Name: notification_deliveries_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_deliveries_pending_idx ON public.notification_deliveries USING btree (channel, "queuedAt") WHERE (status = 'pending'::text);


--
-- Name: notification_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_jobs_claim_idx ON public.notification_jobs USING btree ("notBefore") WHERE (status = 'pending'::text);


--
-- Name: notification_jobs_event_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_jobs_event_uniq ON public.notification_jobs USING btree ("eventKey");


--
-- Name: notification_jobs_type_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_jobs_type_entity_idx ON public.notification_jobs USING btree (type, "entityId");


--
-- Name: notification_preferences_user_category_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_preferences_user_category_uniq ON public.notification_preferences USING btree ("userId", category);


--
-- Name: notifications_collapse_open_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notifications_collapse_open_uniq ON public.notifications USING btree ("userId", "collapseKey") WHERE ("readAt" IS NULL);


--
-- Name: notifications_escalation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_escalation_idx ON public.notifications USING btree ("createdAt") WHERE ("resolvedAt" IS NULL);


--
-- Name: notifications_unseen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unseen_idx ON public.notifications USING btree ("userId", "createdAt") WHERE ("seenAt" IS NULL);


--
-- Name: notifications_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_created_idx ON public.notifications USING btree ("userId", "createdAt" DESC);


--
-- Name: notifications_user_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree ("userId", "createdAt" DESC) WHERE ("readAt" IS NULL);


--
-- Name: pending_upgrades_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_upgrades_email_idx ON public.pending_upgrades USING btree (email);


--
-- Name: pending_upgrades_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_upgrades_status_idx ON public.pending_upgrades USING btree (status);


--
-- Name: push_subscriptions_endpoint_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX push_subscriptions_endpoint_uniq ON public.push_subscriptions USING btree (endpoint);


--
-- Name: push_subscriptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree ("userId");


--
-- Name: qualify_draft_review_agency_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX qualify_draft_review_agency_created_idx ON public.qualify_draft_review USING btree ("agencyId", "createdAt" DESC);


--
-- Name: recovery_alerts_agency_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recovery_alerts_agency_status_created_idx ON public.recovery_alerts USING btree ("agencyId", status, "createdAt" DESC);


--
-- Name: recovery_alerts_one_open_per_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recovery_alerts_one_open_per_lead ON public.recovery_alerts USING btree ("leadId") WHERE (status = 'open'::text);


--
-- Name: sales_quote_items_quote_line_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_quote_items_quote_line_uniq ON public.sales_quote_items USING btree ("quoteId", "lineNumber");


--
-- Name: sales_quote_template_items_template_line_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_quote_template_items_template_line_uniq ON public.sales_quote_template_items USING btree ("templateId", "lineNumber");


--
-- Name: sales_quote_templates_agency_name_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_quote_templates_agency_name_uniq ON public.sales_quote_templates USING btree ("agencyId", name) WHERE (state = 'active'::text);


--
-- Name: sales_quote_templates_agency_state_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_quote_templates_agency_state_name_idx ON public.sales_quote_templates USING btree ("agencyId", state, name);


--
-- Name: sales_quotes_agency_automation_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_quotes_agency_automation_key_uniq ON public.sales_quotes USING btree ("agencyId", "automationKey") WHERE ("automationKey" IS NOT NULL);


--
-- Name: sales_quotes_agency_lead_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_quotes_agency_lead_created_idx ON public.sales_quotes USING btree ("agencyId", "leadId", "createdAt" DESC);


--
-- Name: sales_quotes_agency_status_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_quotes_agency_status_expires_idx ON public.sales_quotes USING btree ("agencyId", status, "expiresAt") WHERE (status = ANY (ARRAY['sent'::text, 'accepted'::text]));


--
-- Name: sales_quotes_agency_year_number_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_quotes_agency_year_number_uniq ON public.sales_quotes USING btree ("agencyId", "quoteYear", "quoteNumber") WHERE (status <> 'draft'::text);


--
-- Name: subscriptions_grow_direct_debit_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_grow_direct_debit_id_idx ON public.subscriptions USING btree ("growDirectDebitId") WHERE ("growDirectDebitId" IS NOT NULL);


--
-- Name: support_messages_request_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_messages_request_created_idx ON public.support_messages USING btree ("requestId", "createdAt");


--
-- Name: support_requests_agency_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_requests_agency_author_idx ON public.support_requests USING btree ("agencyId", "createdByUserId", "createdAt" DESC);


--
-- Name: support_requests_agency_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_requests_agency_created_idx ON public.support_requests USING btree ("agencyId", "createdAt" DESC);


--
-- Name: support_requests_author_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_requests_author_created_idx ON public.support_requests USING btree ("createdByUserId", "createdAt" DESC);


--
-- Name: support_requests_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_requests_open_idx ON public.support_requests USING btree ("lastMessageAt" DESC) WHERE (status <> 'resolved'::text);


--
-- Name: tasks_clientid_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_clientid_index ON public.tasks USING btree ("clientId");


--
-- Name: tasks_tmpltid_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_tmpltid_index ON public.tasks USING btree ("tmpltId");


--
-- Name: tasks_userid_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_userid_index ON public.tasks USING btree ("userId");


--
-- Name: users_facebookSub_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "users_facebookSub_unique" ON public.users USING btree ("facebookSub");


--
-- Name: webhook_failures_page_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_failures_page_unresolved ON public.webhook_failures USING btree (page_id) WHERE (resolved = false);


--
-- Name: whatsapp_connections_waba_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_connections_waba_idx ON public.whatsapp_connections USING btree (waba_id);


--
-- Name: whatsapp_templates_agency_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_templates_agency_status_idx ON public.whatsapp_templates USING btree ("agencyId", status);


--
-- Name: whatsapp_templates_identity_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_templates_identity_uniq ON public.whatsapp_templates USING btree ("wabaId", name, language);


--
-- Name: _sales _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public._sales AS
 SELECT s.id,
    s.status,
    s.action,
    s.company,
    s.branch,
    s.prdct,
    s."prdctType",
    s."saleDt",
    s."offrDt",
    s."clientId",
    s."createdAt",
    s."updatedAt",
    s."createdById",
    s.notes,
    s."otherAgnt",
    s."favSalesId",
    s.amount,
    s.cmsn,
    s.replace,
    s."handlerId",
    s."leadSource",
    s.rwrd,
    s.tfuca,
    s."agencyId",
    s."bizNum",
    s."bizName",
    s.rwrd AS bonus,
    s.replace AS "isUpgrade",
    c.details AS "clientData",
    ru.name AS "handlerName",
        CASE
            WHEN (count(su."userId") > 1) THEN string_agg(concat(u.name, '(', su.prcnt, '%)'), ' & '::text ORDER BY su.prcnt DESC)
            ELSE max(u.name)
        END AS "userName",
    array_agg(su."userId") AS "userIds",
    array_agg(su.prcnt) AS "userPrcnts"
   FROM ((((public.sales s
     LEFT JOIN public.clients c ON ((s."clientId" = c.id)))
     LEFT JOIN public.sale_users su ON ((s.id = su."saleId")))
     LEFT JOIN public.users u ON ((su."userId" = u.id)))
     LEFT JOIN public.users ru ON ((s."handlerId" = ru.id)))
  GROUP BY s.id, c.details, ru.name
  ORDER BY s."updatedAt" DESC;


--
-- Name: _teams _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public._teams AS
 SELECT t.id,
    t.name,
    t."agencyId",
    t."updatedAt",
    COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FILTER (WHERE ((ut.type = 'user'::text) AND (u.id IS NOT NULL))), '[]'::json) AS users,
    COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FILTER (WHERE ((ut.type = 'mngr'::text) AND (u.id IS NOT NULL))), '[]'::json) AS mngrs,
    COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name) FILTER (WHERE ((ut.type = 'office'::text) AND (u.id IS NOT NULL))), '[]'::json) AS offices,
    COALESCE(array_agg(u.id) FILTER (WHERE ((ut.type = 'user'::text) AND (u.id IS NOT NULL))), '{}'::integer[]) AS "userIds",
    COALESCE(array_agg(u.id) FILTER (WHERE ((ut.type = 'mngr'::text) AND (u.id IS NOT NULL))), '{}'::integer[]) AS "mngrIds",
    COALESCE(array_agg(u.id) FILTER (WHERE ((ut.type = 'office'::text) AND (u.id IS NOT NULL))), '{}'::integer[]) AS "officeIds"
   FROM ((public.teams t
     LEFT JOIN public.user_teams ut ON ((t.id = ut."teamId")))
     LEFT JOIN public.users u ON ((ut."userId" = u.id)))
  GROUP BY t.id;


--
-- Name: clients add_zeros_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER add_zeros_trigger BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.add_zeros_to_idnum();


--
-- Name: clients client_info_insert_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER client_info_insert_trigger AFTER INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public.create_client_info_entry();


--
-- Name: teams set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: users set_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: users user_info_insert_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_info_insert_trigger AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.create_user_info_entry();


--
-- Name: clients Client_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales Sale_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT "Sale_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales Sale_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT "Sale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: agencies agencies_img_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agencies
    ADD CONSTRAINT agencies_img_foreign FOREIGN KEY (img) REFERENCES public.files(id);


--
-- Name: ai_belief_versions ai_belief_versions_beliefId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_belief_versions
    ADD CONSTRAINT "ai_belief_versions_beliefId_fkey" FOREIGN KEY ("beliefId") REFERENCES public.ai_beliefs(id) ON DELETE CASCADE;


--
-- Name: ai_conversations ai_conversations_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT "ai_conversations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public.users(id);


--
-- Name: ai_conversations ai_conversations_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT "ai_conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: ai_messages ai_messages_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.ai_conversations(id) ON DELETE CASCADE;


--
-- Name: ai_messages ai_messages_parentMessageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT "ai_messages_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES public.ai_messages(id) ON DELETE SET NULL;


--
-- Name: ai_provenance ai_provenance_beliefId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provenance
    ADD CONSTRAINT "ai_provenance_beliefId_fkey" FOREIGN KEY ("beliefId") REFERENCES public.ai_beliefs(id) ON DELETE CASCADE;


--
-- Name: ai_runs ai_runs_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_runs
    ADD CONSTRAINT "ai_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.ai_conversations(id) ON DELETE SET NULL;


--
-- Name: ai_runs ai_runs_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_runs
    ADD CONSTRAINT "ai_runs_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public.ai_messages(id) ON DELETE SET NULL;


--
-- Name: ai_runs ai_runs_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_runs
    ADD CONSTRAINT "ai_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_agencyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT "analytics_events_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: analytics_events analytics_events_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT "analytics_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: auto_response_jobs auto_response_jobs_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_response_jobs
    ADD CONSTRAINT "auto_response_jobs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE CASCADE;


--
-- Name: auto_response_jobs auto_response_jobs_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_response_jobs
    ADD CONSTRAINT "auto_response_jobs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: automation_activity automation_activity_automationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_activity
    ADD CONSTRAINT "automation_activity_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES public.automation_definitions(id);


--
-- Name: automation_jobs automation_jobs_automationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_jobs
    ADD CONSTRAINT "automation_jobs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES public.automation_definitions(id);


--
-- Name: automation_send_claims automation_send_claims_automationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_send_claims
    ADD CONSTRAINT "automation_send_claims_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES public.automation_definitions(id);


--
-- Name: automation_sources automation_sources_connectionRowId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sources
    ADD CONSTRAINT "automation_sources_connectionRowId_fkey" FOREIGN KEY ("connectionRowId") REFERENCES public.automation_connections(id) ON DELETE CASCADE;


--
-- Name: automation_template_installs automation_template_installs_automationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_template_installs
    ADD CONSTRAINT "automation_template_installs_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES public.automation_definitions(id) ON DELETE CASCADE;


--
-- Name: bill_billing_profiles bill_billing_profiles_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_billing_profiles
    ADD CONSTRAINT "bill_billing_profiles_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public.users(id);


--
-- Name: bill_billing_profiles bill_billing_profiles_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_billing_profiles
    ADD CONSTRAINT "bill_billing_profiles_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: bill_documents bill_documents_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_documents
    ADD CONSTRAINT "bill_documents_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public.bill_invoices(id) ON DELETE RESTRICT;


--
-- Name: bill_documents bill_documents_renderedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_documents
    ADD CONSTRAINT "bill_documents_renderedByUserId_fkey" FOREIGN KEY ("renderedByUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bill_financial_events bill_financial_events_actorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_financial_events
    ADD CONSTRAINT "bill_financial_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bill_financial_events bill_financial_events_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_financial_events
    ADD CONSTRAINT "bill_financial_events_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public.bill_invoices(id) ON DELETE CASCADE;


--
-- Name: bill_financial_events bill_financial_events_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_financial_events
    ADD CONSTRAINT "bill_financial_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: bill_invoice_lines bill_invoice_lines_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoice_lines
    ADD CONSTRAINT "bill_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public.bill_invoices(id) ON DELETE CASCADE;


--
-- Name: bill_invoice_lines bill_invoice_lines_taxRateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoice_lines
    ADD CONSTRAINT "bill_invoice_lines_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES public.bill_tax_rates(id) ON DELETE RESTRICT;


--
-- Name: bill_invoice_versions bill_invoice_versions_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoice_versions
    ADD CONSTRAINT "bill_invoice_versions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public.bill_invoices(id) ON DELETE CASCADE;


--
-- Name: bill_invoice_versions bill_invoice_versions_savedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoice_versions
    ADD CONSTRAINT "bill_invoice_versions_savedByUserId_fkey" FOREIGN KEY ("savedByUserId") REFERENCES public.users(id);


--
-- Name: bill_invoices bill_invoices_billingProfileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoices
    ADD CONSTRAINT "bill_invoices_billingProfileId_fkey" FOREIGN KEY ("billingProfileId") REFERENCES public.bill_billing_profiles(id) ON DELETE RESTRICT;


--
-- Name: bill_invoices bill_invoices_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoices
    ADD CONSTRAINT "bill_invoices_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public.users(id);


--
-- Name: bill_invoices bill_invoices_issuedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoices
    ADD CONSTRAINT "bill_invoices_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES public.users(id);


--
-- Name: bill_invoices bill_invoices_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoices
    ADD CONSTRAINT "bill_invoices_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE RESTRICT;


--
-- Name: bill_invoices bill_invoices_replacedByInvoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_invoices
    ADD CONSTRAINT "bill_invoices_replacedByInvoiceId_fkey" FOREIGN KEY ("replacedByInvoiceId") REFERENCES public.bill_invoices(id);


--
-- Name: bill_tax_rates bill_tax_rates_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bill_tax_rates
    ADD CONSTRAINT "bill_tax_rates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: client_lists client_lists_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_lists
    ADD CONSTRAINT "client_lists_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: clients clients_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: clients clients_handlerid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_handlerid_foreign FOREIGN KEY ("handlerId") REFERENCES public.users(id);


--
-- Name: clients_info clients_info_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients_info
    ADD CONSTRAINT clients_info_id_foreign FOREIGN KEY (id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: clients clients_userid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_userid_foreign FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: cmsn_rules cmsn_rules_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cmsn_rules
    ADD CONSTRAINT cmsn_rules_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: contract_prdcts contract_prdcts_contractid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_prdcts
    ADD CONSTRAINT contract_prdcts_contractid_foreign FOREIGN KEY ("contractId") REFERENCES public.contracts(id);


--
-- Name: contracts contracts_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: contracts contracts_leaderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT "contracts_leaderId_fkey" FOREIGN KEY ("mngrId") REFERENCES public.users(id);


--
-- Name: conversation_ai_state conversation_ai_state_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_ai_state
    ADD CONSTRAINT "conversation_ai_state_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_analysis_jobs conversation_analysis_jobs_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_analysis_jobs
    ADD CONSTRAINT "conversation_analysis_jobs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_intelligence conversation_intelligence_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_intelligence
    ADD CONSTRAINT "conversation_intelligence_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_intelligence_runs conversation_intelligence_runs_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_intelligence_runs
    ADD CONSTRAINT "conversation_intelligence_runs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE CASCADE;


--
-- Name: default_settings default_settings_userid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_settings
    ADD CONSTRAINT default_settings_userid_foreign FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: facebook_page_comments facebook_page_comments_convertedLeadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook_page_comments
    ADD CONSTRAINT "facebook_page_comments_convertedLeadId_fkey" FOREIGN KEY ("convertedLeadId") REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: facebook_pages facebook_pages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook_pages
    ADD CONSTRAINT facebook_pages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: files files_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: files files_clientid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_clientid_foreign FOREIGN KEY ("clientId") REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: files files_createdbyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_createdbyid_foreign FOREIGN KEY ("createdById") REFERENCES public.users(id);


--
-- Name: files files_taskid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_taskid_foreign FOREIGN KEY ("taskId") REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: google_calendar_connections google_calendar_connections_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_connections
    ADD CONSTRAINT google_calendar_connections_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: google_drive_connections google_drive_connections_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_drive_connections
    ADD CONSTRAINT google_drive_connections_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: inbox_conversation_reads inbox_conversation_reads_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_conversation_reads
    ADD CONSTRAINT "inbox_conversation_reads_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE CASCADE;


--
-- Name: inbox_conversation_reads inbox_conversation_reads_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_conversation_reads
    ADD CONSTRAINT "inbox_conversation_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: inbox_conversations inbox_conversations_leadid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_conversations
    ADD CONSTRAINT inbox_conversations_leadid_fkey FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: inbox_conversations inbox_conversations_personalMarkedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_conversations
    ADD CONSTRAINT "inbox_conversations_personalMarkedByUserId_fkey" FOREIGN KEY ("personalMarkedByUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inbox_messages inbox_messages_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT "inbox_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE CASCADE;


--
-- Name: inbox_messages inbox_messages_leadid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_leadid_fkey FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: inbox_messages inbox_messages_sentByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT "inbox_messages_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inbox_participants inbox_participants_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_participants
    ADD CONSTRAINT "inbox_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE CASCADE;


--
-- Name: inbox_participants inbox_participants_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_participants
    ADD CONSTRAINT "inbox_participants_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: invitations invitations_createdbyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_createdbyid_foreign FOREIGN KEY ("createdById") REFERENCES public.users(id);


--
-- Name: lead_drive_files lead_drive_files_lead_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_drive_files
    ADD CONSTRAINT lead_drive_files_lead_id_foreign FOREIGN KEY (lead_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: meeting_attendees meeting_attendees_lead_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_lead_id_foreign FOREIGN KEY (lead_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: meeting_attendees meeting_attendees_meeting_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_meeting_id_foreign FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_attendees meeting_attendees_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_lead_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_lead_id_foreign FOREIGN KEY (lead_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_organizer_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_organizer_user_id_foreign FOREIGN KEY (organizer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notification_deliveries notification_deliveries_groupedIntoDeliveryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT "notification_deliveries_groupedIntoDeliveryId_fkey" FOREIGN KEY ("groupedIntoDeliveryId") REFERENCES public.notification_deliveries(id) ON DELETE SET NULL;


--
-- Name: notification_deliveries notification_deliveries_notificationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: payments payments_agencyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT "payments_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: pending_upgrades pending_upgrades_agencyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_upgrades
    ADD CONSTRAINT "pending_upgrades_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: promo promo_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promo
    ADD CONSTRAINT promo_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: recovery_alerts recovery_alerts_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_alerts
    ADD CONSTRAINT "recovery_alerts_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.inbox_conversations(id) ON DELETE SET NULL;


--
-- Name: recovery_alerts recovery_alerts_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recovery_alerts
    ADD CONSTRAINT "recovery_alerts_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: sale_users sale_users_saleid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_users
    ADD CONSTRAINT sale_users_saleid_foreign FOREIGN KEY ("saleId") REFERENCES public.sales(id) ON DELETE CASCADE;


--
-- Name: sale_users sale_users_userid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_users
    ADD CONSTRAINT sale_users_userid_foreign FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sales sales_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: sales_quote_items sales_quote_items_quoteId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_items
    ADD CONSTRAINT "sales_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES public.sales_quotes(id) ON DELETE CASCADE;


--
-- Name: sales_quote_items sales_quote_items_taxRateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_items
    ADD CONSTRAINT "sales_quote_items_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES public.bill_tax_rates(id) ON DELETE RESTRICT;


--
-- Name: sales_quote_template_items sales_quote_template_items_templateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_template_items
    ADD CONSTRAINT "sales_quote_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES public.sales_quote_templates(id) ON DELETE CASCADE;


--
-- Name: sales_quote_templates sales_quote_templates_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quote_templates
    ADD CONSTRAINT "sales_quote_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public.users(id);


--
-- Name: sales_quotes sales_quotes_convertedInvoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotes
    ADD CONSTRAINT "sales_quotes_convertedInvoiceId_fkey" FOREIGN KEY ("convertedInvoiceId") REFERENCES public.bill_invoices(id) ON DELETE SET NULL;


--
-- Name: sales_quotes sales_quotes_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotes
    ADD CONSTRAINT "sales_quotes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public.users(id);


--
-- Name: sales_quotes sales_quotes_leadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotes
    ADD CONSTRAINT "sales_quotes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: sales_quotes sales_quotes_ownerUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotes
    ADD CONSTRAINT "sales_quotes_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sales_quotes sales_quotes_sentByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotes
    ADD CONSTRAINT "sales_quotes_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sales_quotes sales_quotes_templateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_quotes
    ADD CONSTRAINT "sales_quotes_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES public.sales_quote_templates(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_agencyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: support_messages support_messages_authorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT "support_messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_messages support_messages_requestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT "support_messages_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public.support_requests(id) ON DELETE CASCADE;


--
-- Name: support_requests support_requests_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_requests
    ADD CONSTRAINT "support_requests_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: task_tmplts task_tmplts_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tmplts
    ADD CONSTRAINT task_tmplts_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: teams teams_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: user_perms user_perms_gaveid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_perms
    ADD CONSTRAINT user_perms_gaveid_foreign FOREIGN KEY ("gaveId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_perms user_perms_gotid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_perms
    ADD CONSTRAINT user_perms_gotid_foreign FOREIGN KEY ("gotId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_teams user_teams_teamid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_teamid_foreign FOREIGN KEY ("teamId") REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: user_teams user_teams_userid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_userid_foreign FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_agencyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_agencyid_foreign FOREIGN KEY ("agencyId") REFERENCES public.agencies(id);


--
-- Name: users users_createdbyid_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_createdbyid_foreign FOREIGN KEY ("createdById") REFERENCES public.users(id);


--
-- Name: users_info users_info_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users_info
    ADD CONSTRAINT users_info_id_foreign FOREIGN KEY (id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: whatsapp_connections whatsapp_connections_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_connections
    ADD CONSTRAINT whatsapp_connections_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


