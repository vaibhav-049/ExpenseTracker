module.exports = (sequelize, Sequelize) => {
    const Expense = sequelize.define('expense', {
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
        amount: {
            type: Sequelize.DECIMAL(10, 2),
            allowNull: false
        },
        category: {
            type: Sequelize.STRING(50),
            allowNull: false
        },
        description: {
            type: Sequelize.TEXT,
            allowNull: true
        },
        date: {
            type: Sequelize.DATEONLY,
            allowNull: false,
            defaultValue: Sequelize.NOW
        }
    }, {
        timestamps: true,
        tableName: 'expenses'
    });

    return Expense;
};
