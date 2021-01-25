odoo.define("account_reconcile_partial.ReconciliationModel", function (require) {

    var model = require('account.ReconciliationModel');
    var field_utils = require('web.field_utils');
    var utils = require('web.utils');
    var session = require('web.session');

    model.StatementModel.include({
        getPartialReconcileAmount: function(handle, data) {
            var line = this.getLine(handle);
            var prop = _.find(line.reconciliation_proposition, {'id': data.data});
            if (prop) {
                var amount = prop.partial_amount || prop.amount;
                // Check if we can get a partial amount
                // that would directly set balance to zero
                var partial = Math.abs(line.balance.amount + amount);
                if (partial <= Math.abs(prop.amount)) {
                    return partial;
                }
                return Math.abs(amount);
            }
        },
        partialReconcile: function(handle, data) {
            var line = this.getLine(handle);
            var prop = _.find(
                line.reconciliation_proposition, {'id' : data.mvLineId});
            var save = prop;
            var company_currency = session.get_currency(line.st_line.currency_id);
            var company_precision = company_currency && company_currency.digits[1] || 2;
            var targetLineAmount = 0;
            _.each(line.reconciliation_proposition, function (old_line) {
                if (!prop.invalid) {
                    targetLineAmount += old_line.amount;
                }
            });
            if (prop) {
                var amount = data.amount;
                try {
                    amount = field_utils.parse.float(data.amount);
                }
                catch (err) {
                    amount = NaN;
                }
                //console.log("RECONSILE", utils.round_decimals(line.st_line.amount, company_precision), targetLineAmount, "-", prop.amount, "+", (prop.amount > 0 ? 1 : -1)*amount, utils.round_decimals(targetLineAmount - prop.amount + (prop.amount > 0 ? 1 : -1)*amount, company_precision), line, data, "prop", save, this.lines);
                if (
                    amount >= Math.abs(prop.amount)
                    || amount <= 0 || isNaN(amount)
                ) {
                    delete prop.partial_amount_str;
                    delete prop.partial_amount;
                    if (isNaN(amount) || amount < 0) {
                        this.do_warn(_.str.sprintf(_t(
                            'The amount %s is not a valid partial amount'
                            ), data.amount));
                    }
                    return this._computeLine(line);
                }
                else {
                    var format_options = { currency_id: line.st_line.currency_id };
                    amount = (prop.amount > 0 ? 1 : -1)*amount;
                    if (utils.round_decimals(targetLineAmount - prop.amount + amount, company_precision) == utils.round_decimals(line.st_line.amount, company_precision)) {
                        //prop.partial_reconcile = false;
                        prop.amount = amount;
                        prop.base_amount = amount;
                        prop.amount_str = field_utils.format.monetary(
                        Math.abs(amount), {}, format_options);
                    } else {
                        prop.partial_reconcile = true;
                        prop.partial_amount = amount;
                        prop.write_off_amount = prop.partial_amount;
                        prop.partial_amount_str = field_utils.format.monetary(
                        Math.abs(prop.partial_amount), {}, format_options);
                    }

                }
            }
            console.log("RECONSILE", prop);
            return this._computeLine(line);
        },
        _computeLine: function (line) {
        // Fixing the computation of the balance in order to use
        // amount_reconcile if it will be partially reconciled
            var self = this;
            var formatOptions = {
                currency_id: line.st_line.currency_id,
            };
            return this._super.apply(this, arguments).then(function () {

                var amount_currency = 0;
                var total = line.st_line.amount || 0;
                var isOtherCurrencyId = _.uniq(_.pluck(_.reject(
                    line.reconciliation_proposition, 'invalid'), 'currency_id'));
                isOtherCurrencyId = (
                    isOtherCurrencyId.length === 1
                    && !total
                    && isOtherCurrencyId[0] !== formatOptions.currency_id
                    ? isOtherCurrencyId[0] : false);

                _.each(line.reconciliation_proposition, function (prop) {
                    if (!prop.invalid) {
                        if (prop.partial_reconcile)
                            total -= prop.partial_amount || prop.amount;
                        else
                            total -= prop.amount;
                        if (isOtherCurrencyId) {
                            amount_currency -= (
                                prop.amount < 0 ? -1 : 1
                            ) * Math.abs(prop.amount_currency);
                        }
                    }
                });
                var company_currency = session.get_currency(
                    line.st_line.currency_id);
                var company_precision = (
                    company_currency && company_currency.digits[1] || 2);
                total = utils.round_decimals(total, company_precision) || 0;
                if(isOtherCurrencyId){
                    var other_currency = session.get_currency(isOtherCurrencyId);
                    var other_precision = other_currency && other_currency.digits[1] || 2;
                    amount_currency = utils.round_decimals(amount_currency, other_precision);
                }
                line.balance = {
                    amount: total,
                    amount_str: field_utils.format.monetary(Math.abs(total), {}, formatOptions),
                    currency_id: isOtherCurrencyId,
                    amount_currency: isOtherCurrencyId ? amount_currency : total,
                    amount_currency_str: isOtherCurrencyId ? field_utils.format.monetary(
                        Math.abs(amount_currency), {}, {
                            currency_id: isOtherCurrencyId
                        }) : false,
                    account_code: self.accounts[line.st_line.open_balance_account_id],
                };
                line.balance.show_balance = line.balance.amount_currency != 0;
                line.balance.type = line.balance.amount_currency ? (line.st_line.partner_id ? 0 : -1) : 1;
            });
        },
    });
});
