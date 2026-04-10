module.exports = (sequelize, Sequelize) => {
    const ImportFile = sequelize.define('import_file', {
        id: {
            type: Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        userId: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        fileHash: {
            type: Sequelize.STRING(64),
            allowNull: false
        },
        importMode: {
            type: Sequelize.STRING(30),
            allowNull: false,
            defaultValue: 'file'
        },
        importedCount: {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0
        }
    }, {
        timestamps: true,
        tableName: 'import_files',
        indexes: [
            {
                unique: true,
                fields: ['userId', 'fileHash']
            }
        ]
    });

    return ImportFile;
};
