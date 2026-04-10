module.exports = (sequelize, Sequelize) => {
    const RecurringExpense = sequelize.define('recurring_expense', {
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
        frequency: {
            type: Sequelize.ENUM('daily', 'weekly', 'monthly'),
            allowNull: false,
            defaultValue: 'monthly'
        },
        startDate: {
            type: Sequelize.DATEONLY,
            allowNull: false
        },
        nextRunDate: {
            type: Sequelize.DATEONLY,
            allowNull: false
        },
        endDate: {
            type: Sequelize.DATEONLY,
            allowNull: true
        },
        isActive: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true
        }
    }, {
        timestamps: true,
        tableName: 'recurring_expenses'
    });

    return RecurringExpense;
};