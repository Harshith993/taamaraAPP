-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('INTERNAL', 'VENDOR', 'LABOUR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('ALL', 'ASSIGNED', 'OWN');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('TENTATIVE', 'CONFIRMED', 'PLANNING', 'LIVE', 'COMPLETED', 'SETTLED', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventMemberRole" AS ENUM ('MANAGER', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "RequirementSource" AS ENUM ('CLIENT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('OPEN', 'QUOTING', 'COVERED', 'DROPPED');

-- CreateEnum
CREATE TYPE "ScheduleItemType" AS ENUM ('SETUP', 'VENDOR_REPORTING', 'CREW_REPORTING', 'CEREMONY', 'MEAL', 'PERFORMANCE', 'DISMANTLE', 'DEADLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "VendorAssignmentStatus" AS ENUM ('INVITED', 'QUOTED', 'APPROVED', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('SUBMITTED', 'REVISION_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('ISSUED', 'ACKNOWLEDGED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VendorInvoiceStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'APPROVED', 'PART_PAID', 'PAID', 'DISPUTED', 'VOID');

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CrewAssignmentStatus" AS ENUM ('ASSIGNED', 'CONFIRMED', 'DECLINED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PENDING', 'PRESENT', 'LATE', 'ABSENT');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('SUPERVISOR', 'SELF_GPS', 'QR');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('EXTRA', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETED', 'DELAYED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseGroup" AS ENUM ('VENDOR', 'LABOUR', 'TRANSPORT', 'EQUIPMENT', 'FOOD', 'ACCOMMODATION', 'MISC');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "ClientInvoiceType" AS ENUM ('ADVANCE', 'FINAL', 'ADDITIONAL');

-- CreateEnum
CREATE TYPE "ClientInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CLIENT', 'VENDOR', 'WORKER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK', 'CHEQUE', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED');

-- CreateEnum
CREATE TYPE "ExpensePaidVia" AS ENUM ('COMPANY', 'CASH_ADVANCE', 'OWN_POCKET');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('QUOTATION', 'PAYMENT', 'EXPENSE', 'CREW_ADJUSTMENT', 'BUDGET');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CONTRACT', 'QUOTATION', 'INVOICE', 'PLAN', 'DESIGN', 'PHOTO', 'VIDEO', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('OWNER_ONLY', 'INTERNAL', 'BOOKING_TEAM', 'SHARED');

-- CreateEnum
CREATE TYPE "ShareTarget" AS ENUM ('USER', 'VENDOR', 'BOOKING_CREW');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ProofKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('BOOKING_TEAM', 'VENDOR_THREAD', 'CREW', 'DIRECT');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL_STAFF', 'ALL_CREW', 'ALL_VENDORS', 'BOOKING_TEAM', 'BOOKING_CREW', 'BOOKING_VENDORS');

-- CreateEnum
CREATE TYPE "InventoryCondition" AS ENUM ('GOOD', 'NEEDS_REPAIR', 'RETIRED');

-- CreateTable
CREATE TABLE "company_profile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL DEFAULT 'Taamara Taamara',
    "tagline" TEXT DEFAULT 'events & beyond',
    "gstin" TEXT,
    "pan" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" VARCHAR(2),
    "phone" TEXT,
    "email" TEXT,
    "logoFileId" TEXT,
    "bankDetails" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "phoneNumber" TEXT,
    "phoneNumberVerified" BOOLEAN DEFAULT false,
    "hasRealEmail" BOOLEAN NOT NULL DEFAULT true,
    "accountType" "AccountType" NOT NULL DEFAULT 'INTERNAL',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accountType" "AccountType" NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "financial" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "type" "ClientType" NOT NULL DEFAULT 'INDIVIDUAL',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#861A41',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "defaultTemplateId" TEXT,

    CONSTRAINT "event_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "mapUrl" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "contact" TEXT,
    "capacity" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'TENTATIVE',
    "startDate" DATE,
    "endDate" DATE,
    "expectedGuests" INTEGER,
    "description" TEXT,
    "shareHostContactWithVendors" BOOLEAN NOT NULL DEFAULT false,
    "cancelledReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_functions" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "venueId" TEXT,
    "venueText" TEXT,
    "expectedGuests" INTEGER,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_members" (
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "EventMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_members_pkey" PRIMARY KEY ("eventId","userId","role")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "functionId" TEXT,
    "vendorCategoryId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(10,2),
    "unit" TEXT,
    "source" "RequirementSource" NOT NULL DEFAULT 'INTERNAL',
    "status" "RequirementStatus" NOT NULL DEFAULT 'OPEN',
    "vendorAssignmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_items" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "functionId" TEXT,
    "type" "ScheduleItemType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "responsibleUserId" TEXT,
    "vendorAssignmentId" TEXT,
    "visibleToVendors" BOOLEAN NOT NULL DEFAULT false,
    "visibleToCrew" BOOLEAN NOT NULL DEFAULT false,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#861A41',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "services" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "ratingAverage" DECIMAL(3,2),
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_category_links" (
    "vendorId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "vendor_category_links_pkey" PRIMARY KEY ("vendorId","categoryId")
);

-- CreateTable
CREATE TABLE "vendor_users" (
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_users_pkey" PRIMARY KEY ("vendorId","userId")
);

-- CreateTable
CREATE TABLE "vendor_bank_details" (
    "vendorId" TEXT NOT NULL,
    "accountName" TEXT,
    "accountNumberEnc" TEXT,
    "accountNumberLast4" VARCHAR(4),
    "ifsc" TEXT,
    "upiId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_bank_details_pkey" PRIMARY KEY ("vendorId")
);

-- CreateTable
CREATE TABLE "vendor_rate_cards" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "unit" TEXT,
    "rate" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "vendor_rate_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_blackouts" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "vendor_blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_assignments" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "categoryId" TEXT,
    "scopeOfWork" TEXT NOT NULL,
    "reportingAt" TIMESTAMP(3),
    "status" "VendorAssignmentStatus" NOT NULL DEFAULT 'INVITED',
    "declineReason" TEXT,
    "agreedAmount" DECIMAL(14,2),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_assignment_functions" (
    "assignmentId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,

    CONSTRAINT "vendor_assignment_functions_pkey" PRIMARY KEY ("assignmentId","functionId")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "validUntil" DATE,
    "notes" TEXT,
    "fileId" TEXT,
    "submittedById" TEXT,
    "reviewNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "terms" TEXT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'ISSUED',
    "pdfFileId" TEXT,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoices" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "taxableAmount" DECIMAL(14,2) NOT NULL,
    "gstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tdsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "fileId" TEXT,
    "status" "VendorInvoiceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "disputeNote" TEXT,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_updates" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "percent" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_reviews" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "quality" INTEGER NOT NULL,
    "punctuality" INTEGER NOT NULL,
    "communication" INTEGER NOT NULL,
    "comment" TEXT,
    "reviewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "experienceYears" INTEGER,
    "usualEventRate" DECIMAL(14,2),
    "idProofFileId" TEXT,
    "bankAccountEnc" TEXT,
    "bankAccountLast4" VARCHAR(4),
    "ifsc" TEXT,
    "upiId" TEXT,
    "emergencyContact" TEXT,
    "supplierVendorId" TEXT,
    "status" "WorkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_skills" (
    "workerId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "worker_skills_pkey" PRIMARY KEY ("workerId","skillId")
);

-- CreateTable
CREATE TABLE "worker_unavailability" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "worker_unavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_assignments" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "duty" TEXT NOT NULL,
    "agreedPay" DECIMAL(14,2) NOT NULL,
    "status" "CrewAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_pay_adjustments" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "type" "AdjustmentType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "state" "ApprovalState" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crew_pay_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_shifts" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "functionId" TEXT,
    "date" DATE NOT NULL,
    "reportAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "attendance" "AttendanceStatus" NOT NULL DEFAULT 'PENDING',
    "method" "AttendanceMethod",
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crew_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "functionId" TEXT,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "reviewerId" TEXT,
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "needsProof" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_attachments" (
    "taskId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("taskId","fileId")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueOffsetDays" INTEGER NOT NULL DEFAULT -7,
    "needsProof" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "task_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "ExpenseGroup" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT,
    "estimatedAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_charges" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sacCode" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "financialYear" TEXT,
    "eventId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ClientInvoiceType" NOT NULL,
    "status" "ClientInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE,
    "dueDate" DATE,
    "placeOfSupply" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "pdfFileId" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_invoice_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sacCode" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "client_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "eventId" TEXT,
    "partyType" "PartyType" NOT NULL,
    "clientId" TEXT,
    "vendorId" TEXT,
    "workerId" TEXT,
    "partyName" TEXT,
    "clientInvoiceId" TEXT,
    "vendorInvoiceId" TEXT,
    "crewAssignmentId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidOn" DATE,
    "proofFileId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "note" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidById" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "spentOn" DATE NOT NULL,
    "paidVia" "ExpensePaidVia" NOT NULL DEFAULT 'COMPANY',
    "cashAdvanceId" TEXT,
    "receiptFileId" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_advances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "givenOn" DATE NOT NULL,
    "settledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventId" TEXT,
    "amount" DECIMAL(14,2),
    "summary" TEXT NOT NULL,
    "state" "ApprovalState" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "docType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("docType","period")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "quantityOwned" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "condition" "InventoryCondition" NOT NULL DEFAULT 'GOOD',
    "photoFileId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_allocations" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "outAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "quantityReturned" INTEGER,
    "quantityDamaged" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "uploadedById" TEXT,
    "status" "FileStatus" NOT NULL DEFAULT 'UPLOADING',
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" INTEGER,
    "thumbnailKey" TEXT,
    "playableKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "vendorId" TEXT,
    "workerId" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_shares" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "target" "ShareTarget" NOT NULL,
    "userId" TEXT,
    "vendorId" TEXT,
    "workerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_proofs" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "functionId" TEXT,
    "taskId" TEXT,
    "vendorAssignmentId" TEXT,
    "crewAssignmentId" TEXT,
    "kind" "ProofKind" NOT NULL,
    "fileId" TEXT NOT NULL,
    "caption" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" "ProofStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "uploadedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "eventId" TEXT,
    "vendorId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_members" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_members_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "senderId" TEXT,
    "body" TEXT NOT NULL,
    "replyToId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "messageId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("messageId","fileId")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "needsAck" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_acks" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_acks_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId","type")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");

-- CreateIndex
CREATE INDEX "users_accountType_status_idx" ON "users"("accountType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "clients_name_idx" ON "clients"("name");

-- CreateIndex
CREATE INDEX "client_contacts_clientId_idx" ON "client_contacts"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "event_categories_name_key" ON "event_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "events_code_key" ON "events"("code");

-- CreateIndex
CREATE INDEX "events_status_startDate_idx" ON "events"("status", "startDate");

-- CreateIndex
CREATE INDEX "events_clientId_idx" ON "events"("clientId");

-- CreateIndex
CREATE INDEX "event_functions_eventId_date_idx" ON "event_functions"("eventId", "date");

-- CreateIndex
CREATE INDEX "event_members_userId_idx" ON "event_members"("userId");

-- CreateIndex
CREATE INDEX "requirements_eventId_idx" ON "requirements"("eventId");

-- CreateIndex
CREATE INDEX "schedule_items_eventId_startsAt_idx" ON "schedule_items"("eventId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_categories_name_key" ON "vendor_categories"("name");

-- CreateIndex
CREATE INDEX "vendors_companyName_idx" ON "vendors"("companyName");

-- CreateIndex
CREATE INDEX "vendor_users_userId_idx" ON "vendor_users"("userId");

-- CreateIndex
CREATE INDEX "vendor_rate_cards_vendorId_idx" ON "vendor_rate_cards"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_blackouts_vendorId_date_key" ON "vendor_blackouts"("vendorId", "date");

-- CreateIndex
CREATE INDEX "vendor_assignments_eventId_idx" ON "vendor_assignments"("eventId");

-- CreateIndex
CREATE INDEX "vendor_assignments_vendorId_status_idx" ON "vendor_assignments"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_assignmentId_version_key" ON "quotations"("assignmentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_number_key" ON "work_orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_quotationId_key" ON "work_orders"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invoices_vendorId_invoiceNumber_key" ON "vendor_invoices"("vendorId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_reviews_vendorId_eventId_reviewerId_key" ON "vendor_reviews"("vendorId", "eventId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE UNIQUE INDEX "workers_userId_key" ON "workers"("userId");

-- CreateIndex
CREATE INDEX "workers_name_idx" ON "workers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "worker_unavailability_workerId_date_key" ON "worker_unavailability"("workerId", "date");

-- CreateIndex
CREATE INDEX "crew_assignments_workerId_idx" ON "crew_assignments"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "crew_assignments_eventId_workerId_key" ON "crew_assignments"("eventId", "workerId");

-- CreateIndex
CREATE INDEX "crew_pay_adjustments_assignmentId_idx" ON "crew_pay_adjustments"("assignmentId");

-- CreateIndex
CREATE INDEX "crew_shifts_assignmentId_idx" ON "crew_shifts"("assignmentId");

-- CreateIndex
CREATE INDEX "crew_shifts_date_idx" ON "crew_shifts"("date");

-- CreateIndex
CREATE INDEX "tasks_eventId_status_idx" ON "tasks"("eventId", "status");

-- CreateIndex
CREATE INDEX "tasks_assigneeId_status_idx" ON "tasks"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "tasks_dueAt_idx" ON "tasks"("dueAt");

-- CreateIndex
CREATE INDEX "task_comments_taskId_idx" ON "task_comments"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_templates_name_key" ON "task_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_eventId_version_key" ON "budgets"("eventId", "version");

-- CreateIndex
CREATE INDEX "budget_lines_budgetId_idx" ON "budget_lines"("budgetId");

-- CreateIndex
CREATE INDEX "client_charges_eventId_idx" ON "client_charges"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_number_key" ON "client_invoices"("number");

-- CreateIndex
CREATE INDEX "client_invoices_eventId_idx" ON "client_invoices"("eventId");

-- CreateIndex
CREATE INDEX "payments_eventId_idx" ON "payments"("eventId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_vendorId_idx" ON "payments"("vendorId");

-- CreateIndex
CREATE INDEX "payments_workerId_idx" ON "payments"("workerId");

-- CreateIndex
CREATE INDEX "expenses_eventId_idx" ON "expenses"("eventId");

-- CreateIndex
CREATE INDEX "approval_requests_state_type_idx" ON "approval_requests"("state", "type");

-- CreateIndex
CREATE INDEX "approval_requests_type_entityId_idx" ON "approval_requests"("type", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_sku_key" ON "inventory_items"("sku");

-- CreateIndex
CREATE INDEX "inventory_allocations_eventId_idx" ON "inventory_allocations"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "files_storageKey_key" ON "files"("storageKey");

-- CreateIndex
CREATE INDEX "documents_eventId_idx" ON "documents"("eventId");

-- CreateIndex
CREATE INDEX "document_shares_documentId_idx" ON "document_shares"("documentId");

-- CreateIndex
CREATE INDEX "work_proofs_eventId_status_idx" ON "work_proofs"("eventId", "status");

-- CreateIndex
CREATE INDEX "work_proofs_uploadedById_idx" ON "work_proofs"("uploadedById");

-- CreateIndex
CREATE INDEX "channels_eventId_idx" ON "channels"("eventId");

-- CreateIndex
CREATE INDEX "channel_members_userId_idx" ON "channel_members"("userId");

-- CreateIndex
CREATE INDEX "messages_channelId_createdAt_idx" ON "messages"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_defaultTemplateId_fkey" FOREIGN KEY ("defaultTemplateId") REFERENCES "task_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "event_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_functions" ADD CONSTRAINT "event_functions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_functions" ADD CONSTRAINT "event_functions_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "event_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_vendorCategoryId_fkey" FOREIGN KEY ("vendorCategoryId") REFERENCES "vendor_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_vendorAssignmentId_fkey" FOREIGN KEY ("vendorAssignmentId") REFERENCES "vendor_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "event_functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_vendorAssignmentId_fkey" FOREIGN KEY ("vendorAssignmentId") REFERENCES "vendor_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_category_links" ADD CONSTRAINT "vendor_category_links_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_category_links" ADD CONSTRAINT "vendor_category_links_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "vendor_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_users" ADD CONSTRAINT "vendor_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bank_details" ADD CONSTRAINT "vendor_bank_details_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_rate_cards" ADD CONSTRAINT "vendor_rate_cards_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_blackouts" ADD CONSTRAINT "vendor_blackouts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assignments" ADD CONSTRAINT "vendor_assignments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assignments" ADD CONSTRAINT "vendor_assignments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assignments" ADD CONSTRAINT "vendor_assignments_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "vendor_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assignment_functions" ADD CONSTRAINT "vendor_assignment_functions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "vendor_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_assignment_functions" ADD CONSTRAINT "vendor_assignment_functions_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "event_functions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "vendor_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "vendor_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_updates" ADD CONSTRAINT "progress_updates_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "vendor_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_supplierVendorId_fkey" FOREIGN KEY ("supplierVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_skills" ADD CONSTRAINT "worker_skills_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_skills" ADD CONSTRAINT "worker_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_unavailability" ADD CONSTRAINT "worker_unavailability_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_pay_adjustments" ADD CONSTRAINT "crew_pay_adjustments_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "crew_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_shifts" ADD CONSTRAINT "crew_shifts_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "crew_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_shifts" ADD CONSTRAINT "crew_shifts_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "event_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_shifts" ADD CONSTRAINT "crew_shifts_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "event_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_template_items" ADD CONSTRAINT "task_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "task_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_charges" ADD CONSTRAINT "client_charges_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_charges" ADD CONSTRAINT "client_charges_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoice_items" ADD CONSTRAINT "client_invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "client_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientInvoiceId_fkey" FOREIGN KEY ("clientInvoiceId") REFERENCES "client_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_vendorInvoiceId_fkey" FOREIGN KEY ("vendorInvoiceId") REFERENCES "vendor_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_crewAssignmentId_fkey" FOREIGN KEY ("crewAssignmentId") REFERENCES "crew_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cashAdvanceId_fkey" FOREIGN KEY ("cashAdvanceId") REFERENCES "cash_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_advances" ADD CONSTRAINT "cash_advances_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_allocations" ADD CONSTRAINT "inventory_allocations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_allocations" ADD CONSTRAINT "inventory_allocations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "event_functions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_vendorAssignmentId_fkey" FOREIGN KEY ("vendorAssignmentId") REFERENCES "vendor_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_crewAssignmentId_fkey" FOREIGN KEY ("crewAssignmentId") REFERENCES "crew_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_acks" ADD CONSTRAINT "announcement_acks_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_acks" ADD CONSTRAINT "announcement_acks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Taamara protections (hand-written; Prisma does not generate these)
-- ═══════════════════════════════════════════════════════════════════════════

-- Exactly one company profile row.
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_single_row" CHECK ("id" = 1);

-- The audit log is append-only.
CREATE OR REPLACE FUNCTION taamara_audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed or deleted' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION taamara_audit_log_append_only();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION taamara_audit_log_append_only();

-- Payments: never deleted; a paid payment can only be voided (with a reason); a voided one is final.
CREATE OR REPLACE FUNCTION taamara_guard_payments() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments are never deleted; void the payment with a reason instead' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'A voided payment cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'VOIDED' AND (NEW."voidReason" IS NULL OR length(btrim(NEW."voidReason")) = 0) THEN
    RAISE EXCEPTION 'Voiding a payment needs a reason' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'PAID' THEN
    IF NEW."status" NOT IN ('PAID', 'VOIDED') THEN
      RAISE EXCEPTION 'A paid payment can only be voided' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."amount" <> OLD."amount"
       OR NEW."direction" <> OLD."direction"
       OR NEW."partyType" <> OLD."partyType"
       OR NEW."method" <> OLD."method"
       OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
       OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
       OR NEW."workerId" IS DISTINCT FROM OLD."workerId"
       OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
       OR NEW."paidOn" IS DISTINCT FROM OLD."paidOn" THEN
      RAISE EXCEPTION 'A paid payment cannot be edited; void it and record a new one' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_guard_update BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_payments();
CREATE TRIGGER payments_guard_delete BEFORE DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_payments();

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_party_matches" CHECK (
  ("partyType" <> 'CLIENT' OR "clientId" IS NOT NULL) AND
  ("partyType" <> 'VENDOR' OR "vendorId" IS NOT NULL) AND
  ("partyType" <> 'WORKER' OR "workerId" IS NOT NULL) AND
  ("partyType" <> 'OTHER'  OR "partyName" IS NOT NULL)
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_direction_matches_party" CHECK (
  ("direction" = 'IN' AND "partyType" IN ('CLIENT', 'OTHER')) OR
  ("direction" = 'OUT' AND "partyType" IN ('VENDOR', 'WORKER', 'OTHER'))
);

-- Client (GST) invoices: only drafts may be deleted; issued numbers and amounts are fixed; cancelling needs a reason.
CREATE OR REPLACE FUNCTION taamara_guard_client_invoices() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'An issued invoice cannot be deleted; cancel it instead' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."subtotal" <> OLD."subtotal" OR NEW."cgst" <> OLD."cgst" OR NEW."sgst" <> OLD."sgst"
       OR NEW."igst" <> OLD."igst" OR NEW."total" <> OLD."total"
       OR NEW."clientId" <> OLD."clientId" OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate" THEN
      RAISE EXCEPTION 'An issued invoice cannot be edited; cancel it and issue a new one' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'An issued invoice cannot go back to draft' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW."status" = 'CANCELLED' AND (NEW."cancelReason" IS NULL OR length(btrim(NEW."cancelReason")) = 0) THEN
    RAISE EXCEPTION 'Cancelling an invoice needs a reason' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER client_invoices_guard_update BEFORE UPDATE ON "client_invoices"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_client_invoices();
CREATE TRIGGER client_invoices_guard_delete BEFORE DELETE ON "client_invoices"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_client_invoices();

CREATE OR REPLACE FUNCTION taamara_guard_client_invoice_items() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT "status" INTO parent_status FROM "client_invoices"
    WHERE "id" = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines of an issued invoice cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER client_invoice_items_guard BEFORE INSERT OR UPDATE OR DELETE ON "client_invoice_items"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_client_invoice_items();

-- Vendor invoices are never deleted (set status VOID instead).
CREATE OR REPLACE FUNCTION taamara_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are never deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_invoices_no_delete BEFORE DELETE ON "vendor_invoices"
  FOR EACH ROW EXECUTE FUNCTION taamara_no_delete();

-- Approved or reimbursed expenses are never deleted.
CREATE OR REPLACE FUNCTION taamara_guard_expenses() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'REIMBURSED') THEN
    RAISE EXCEPTION 'An approved expense cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expenses_guard_delete BEFORE DELETE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION taamara_guard_expenses();

-- Proof belongs to exactly one task, vendor assignment or crew assignment.
ALTER TABLE "work_proofs" ADD CONSTRAINT "work_proofs_one_parent"
  CHECK (num_nonnulls("taskId", "vendorAssignmentId", "crewAssignmentId") = 1);

-- Sensible amounts and ratings.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_pay_non_negative" CHECK ("agreedPay" >= 0);
ALTER TABLE "crew_pay_adjustments" ADD CONSTRAINT "crew_pay_adjustments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_amounts_non_negative" CHECK ("subtotal" >= 0 AND "taxAmount" >= 0 AND "total" >= 0);
ALTER TABLE "client_charges" ADD CONSTRAINT "client_charges_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "vendor_reviews" ADD CONSTRAINT "vendor_reviews_scores_1_to_5" CHECK (
  "quality" BETWEEN 1 AND 5 AND "punctuality" BETWEEN 1 AND 5 AND "communication" BETWEEN 1 AND 5
);
ALTER TABLE "event_functions" ADD CONSTRAINT "event_functions_end_after_start" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt");
