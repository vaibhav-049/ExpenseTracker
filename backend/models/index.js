const { Sequelize } = require('sequelize');
const dbConfig = require('../config/db.config');

const sequelize = new Sequelize({
    dialect: dbConfig.dialect,
    storage: dbConfig.storage,
    logging: dbConfig.logging
});

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;
db.User = require('./user.model')(sequelize, Sequelize);
db.Expense = require('./expense.model')(sequelize, Sequelize);
db.RecurringExpense = require('./recurring-expense.model')(sequelize, Sequelize);
db.BankAccount = require('./bank-account.model')(sequelize, Sequelize);
db.ImportFile = require('./import-file.model')(sequelize, Sequelize);
db.User.hasMany(db.Expense, { foreignKey: 'userId', as: 'expenses' });
db.Expense.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasMany(db.RecurringExpense, { foreignKey: 'userId', as: 'recurringExpenses' });
db.RecurringExpense.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasMany(db.BankAccount, { foreignKey: 'userId', as: 'bankAccounts' });
db.BankAccount.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.User.hasMany(db.ImportFile, { foreignKey: 'userId', as: 'importFiles' });
db.ImportFile.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

module.exports = db;