ALTER TABLE "User"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "emailVerificationTokenHash" TEXT,
ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);

-- Las cuentas existentes fueron creadas antes de que la verificacion fuese
-- obligatoria; no se las bloquea al desplegar esta migracion.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;

CREATE INDEX "User_emailVerificationTokenHash_idx"
ON "User"("emailVerificationTokenHash");
