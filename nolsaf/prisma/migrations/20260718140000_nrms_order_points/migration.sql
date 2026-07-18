-- CreateTable
CREATE TABLE `nrms_order_point` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `propertyId` INTEGER NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `label` VARCHAR(60) NOT NULL,
    `roomUnitId` INTEGER NULL,
    `token` VARCHAR(48) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `nrms_order_point_token_key`(`token`),
    UNIQUE INDEX `nrms_order_point_propertyId_type_label_key`(`propertyId`, `type`, `label`),
    INDEX `nrms_order_point_propertyId_active_idx`(`propertyId`, `active`),
    INDEX `nrms_order_point_roomUnitId_idx`(`roomUnitId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `nrms_order_point` ADD CONSTRAINT `nrms_order_point_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nrms_order_point` ADD CONSTRAINT `nrms_order_point_roomUnitId_fkey` FOREIGN KEY (`roomUnitId`) REFERENCES `room_unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
