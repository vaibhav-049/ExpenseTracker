module.exports = (sequelize, Sequelize) => {
    const BankAccount = sequelize.define('bank_account', {
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
        accountType: {
            type: Sequelize.STRING(30),
            allowNull: false,
            defaultValue: 'bank'
        },
        label: {
            type: Sequelize.STRING(80),
            allowNull: true
        },
        accountNumberEncrypted: {
            type: Sequelize.TEXT,
            allowNull: false
        },
        accountNumberLast4: {
            type: Sequelize.STRING(4),
            allowNull: false
        },
        isActive: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true
        }
    }, {
        timestamps: true,
        tableName: 'bank_accounts'
    });

    return BankAccount;
};
