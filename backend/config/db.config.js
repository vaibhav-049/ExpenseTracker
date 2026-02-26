const path = require('path');
require('dotenv').config();

module.exports = {
    dialect: 'sqlite',
    storage: path.join(__dirname, '..', '..', 'database.sqlite'),
    logging: false
};
